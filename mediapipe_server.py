
import base64
import cv2
import mediapipe as mp
import numpy as np
import os
import sys
from pathlib import Path

from flask import Flask, request, jsonify

# Reuse the classifiers and prediction logic used by the MediaPipe website.
backend_dir = Path(os.environ.get(
    "SIGN_RECOGNITION_PROJECT",
    str(Path.home() / "sign-language-recognition"),
))
if not (backend_dir / "app.py").is_file():
    raise RuntimeError(
        f"Could not find the sign recognition site at {backend_dir}. "
        "Set SIGN_RECOGNITION_PROJECT to the folder containing app.py and the model files."
    )
sys.path.insert(0, str(backend_dir))
import app as sign_site

app = Flask(__name__)

mp_hands = mp.solutions.hands

hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    model_complexity=0,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.5,
)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/predict", methods=["POST"])
def predict_sign():
    data = request.get_json(silent=True) or {}
    image_data = data.get("image")
    mode = data.get("mode", "words")

    if not image_data:
        return jsonify({"error": "No image supplied"}), 400
    if mode not in {"words", "numbers"}:
        return jsonify({"error": "Mode must be 'words' or 'numbers'."}), 400

    try:
        image_bytes = base64.b64decode(image_data)
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        if image is None:
            return jsonify({"error": "Invalid image"}), 400

        # The phone preview is mirrored for a natural selfie view. Match the
        # desktop webcam pipeline so the trained models see the same orientation.
        image = cv2.flip(image, 1)
        image, brightness = sign_site.enhance_frame(image)
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb_image)

        with sign_site.lock:
            mode_changed = sign_site.state.get("mode") != mode
            sign_site.state["mode"] = mode

        if mode_changed:
            sign_site.frame_buffer.clear()
            sign_site.frame_counter = 0
            sign_site.dynamic_cache["label"] = None
            sign_site.dynamic_cache["conf"] = 0.0

        if not results.multi_hand_landmarks:
            sign_site.frame_buffer.clear()
            sign_site.dynamic_cache["label"] = None
            sign_site.dynamic_cache["conf"] = 0.0
            return jsonify({
                "hand_count": 0,
                "sign": "No Hand",
                "confidence": 0,
                "mode": mode,
                "landmarks": [],
                "image_width": int(image.shape[1]),
                "image_height": int(image.shape[0]),
                "brightness": round(brightness, 1),
            })

        label, confidence = sign_site.predict_sign(
            results.multi_hand_landmarks,
            results.multi_handedness or [],
        )
        return jsonify({
            "hand_count": len(results.multi_hand_landmarks),
            "sign": label,
            "confidence": round(confidence * 100),
            "mode": mode,
            "landmarks": [
                {"x": float(point.x), "y": float(point.y), "z": float(point.z)}
                for point in results.multi_hand_landmarks[0].landmark
            ],
            "image_width": int(image.shape[1]),
            "image_height": int(image.shape[0]),
            "brightness": round(brightness, 1),
        })

    except Exception as error:
        app.logger.exception("Landmark detection failed")
        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    # Accessible to your phone on the same Wi-Fi network.
    # Port 5000 is used by the original web app; the mobile app talks to 5001.
    app.run(host="0.0.0.0", port=5001, debug=False)
