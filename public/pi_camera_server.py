"""Stream a Raspberry Pi camera to SignBridge over authenticated MJPEG."""

import io
import logging
import os
import secrets
import socketserver
from http import server
from threading import Condition
from urllib.parse import parse_qs, urlsplit

from picamera2 import Picamera2
from picamera2.encoders import MJPEGEncoder
from picamera2.outputs import FileOutput


PORT = int(os.environ.get("SIGNBRIDGE_PI_CAMERA_PORT", "8000"))
TOKEN = os.environ.get("SIGNBRIDGE_PI_CAMERA_TOKEN") or secrets.token_urlsafe(24)


class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.condition = Condition()

    def write(self, buffer):
        with self.condition:
            self.frame = buffer
            self.condition.notify_all()


class StreamingHandler(server.BaseHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        request = urlsplit(self.path)
        if request.path == "/health":
            body = b"SignBridge Raspberry Pi camera is ready."
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        supplied_token = parse_qs(request.query).get("token", [""])[0]
        if request.path != "/stream.mjpg" or not secrets.compare_digest(supplied_token, TOKEN):
            self.send_response(404 if request.path != "/stream.mjpg" else 403)
            self.send_cors_headers()
            self.end_headers()
            return

        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Age", "0")
        self.send_header("Cache-Control", "no-cache, private")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=FRAME")
        self.end_headers()
        try:
            while True:
                with output.condition:
                    output.condition.wait()
                    frame = output.frame
                self.wfile.write(b"--FRAME\r\n")
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii"))
                self.wfile.write(frame)
                self.wfile.write(b"\r\n")
        except (BrokenPipeError, ConnectionResetError):
            logging.info("Camera stream client disconnected: %s", self.client_address)
        except Exception as error:
            logging.warning("Camera stream client removed: %s", error)


class StreamingServer(socketserver.ThreadingMixIn, server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


camera = Picamera2()
camera.configure(camera.create_video_configuration(main={"size": (640, 480)}))
output = StreamingOutput()
camera.start_recording(MJPEGEncoder(), FileOutput(output))

print(f"Camera stream: http://<pi-ip>:{PORT}/stream.mjpg?token={TOKEN}", flush=True)
print(f"Health check:  http://<pi-ip>:{PORT}/health", flush=True)

try:
    with StreamingServer(("0.0.0.0", PORT), StreamingHandler) as streaming_server:
        streaming_server.serve_forever()
finally:
    camera.stop_recording()
