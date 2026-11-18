"""Local, streaming English and Arabic speech recognition for SignBridge."""

import asyncio
import gc
import json
import os
from pathlib import Path

import websockets
from vosk import KaldiRecognizer, Model


ROOT = Path(__file__).parent
MODEL_PATHS = {
    "en": Path(os.environ.get(
        "SIGNBRIDGE_VOSK_MODEL_EN",
        str(ROOT / "models" / "vosk-model-small-en-us-0.15"),
    )),
    "ar": Path(os.environ.get(
        "SIGNBRIDGE_VOSK_MODEL_AR",
        str(ROOT / "models" / "vosk-model-ar-mgb2-0.4"),
    )),
}
HOST = "0.0.0.0"
PORT = int(os.environ.get("SIGNBRIDGE_SPEECH_PORT", "8765"))
loaded_model: Model | None = None
loaded_language: str | None = None
model_lock = asyncio.Lock()


def transcript_from(result: str, key: str) -> str:
    return str(json.loads(result).get(key, "")).strip()


async def get_model(language: str) -> Model:
    global loaded_model, loaded_language
    async with model_lock:
        if loaded_model is not None and loaded_language == language:
            return loaded_model

        model_path = MODEL_PATHS[language]
        if not model_path.is_dir():
            raise FileNotFoundError(
                f"The {language} speech model is missing. Expected it at {model_path}. "
                "Follow SPEECH_TO_TEXT_SETUP.md to install it."
            )

        # Keep one large language model resident at a time.
        loaded_model = None
        loaded_language = None
        gc.collect()
        loaded_model = await asyncio.to_thread(Model, str(model_path))
        loaded_language = language
        return loaded_model


async def recognize_client(connection) -> None:
    recognizer = None
    try:
        async for message in connection:
            if isinstance(message, str):
                try:
                    command = json.loads(message)
                except json.JSONDecodeError:
                    await connection.send(json.dumps({"type": "error", "message": "Invalid control message."}))
                    continue

                if command.get("type") == "start":
                    sample_rate = int(command.get("sampleRate", 16000))
                    language = command.get("language", "en")
                    if language not in MODEL_PATHS:
                        await connection.send(json.dumps({"type": "error", "message": "Choose English or Arabic."}))
                        return
                    if not 8000 <= sample_rate <= 48000:
                        await connection.send(json.dumps({"type": "error", "message": "Unsupported microphone sample rate."}))
                        return

                    model = await get_model(language)
                    recognizer = KaldiRecognizer(model, sample_rate)
                    recognizer.SetWords(False)
                    await connection.send(json.dumps({"type": "ready", "language": language}))
                elif command.get("type") == "stop":
                    if recognizer is None:
                        await connection.send(json.dumps({"type": "finished", "text": ""}))
                        return
                    final_text = transcript_from(recognizer.FinalResult(), "text")
                    await connection.send(json.dumps({"type": "finished", "text": final_text}))
                    return
                continue

            if recognizer is None:
                await connection.send(json.dumps({"type": "error", "message": "Start a recognition session before sending audio."}))
                return

            is_final = await asyncio.to_thread(recognizer.AcceptWaveform, message)
            if is_final:
                text = transcript_from(recognizer.Result(), "text")
                if text:
                    await connection.send(json.dumps({"type": "final", "text": text}))
            else:
                partial = transcript_from(recognizer.PartialResult(), "partial")
                await connection.send(json.dumps({"type": "partial", "text": partial}))
    except websockets.ConnectionClosed:
        pass
    except Exception as error:
        try:
            await connection.send(json.dumps({"type": "error", "message": str(error)}))
        except websockets.ConnectionClosed:
            pass


async def main() -> None:
    if not MODEL_PATHS["en"].is_dir():
        raise SystemExit(
            "English Vosk model not found. Expected it at "
            f"{MODEL_PATHS['en']}"
        )

    print(f"English model: {MODEL_PATHS['en']}", flush=True)
    print(f"Arabic model:  {MODEL_PATHS['ar']} (optional; download to enable Arabic)", flush=True)
    print(f"Live English/Arabic speech recognition listening on ws://{HOST}:{PORT}", flush=True)
    print("Keep this window open and connect your iPhone on the same Wi-Fi.", flush=True)

    async with websockets.serve(
        recognize_client,
        HOST,
        PORT,
        max_size=None,
        ping_interval=20,
        ping_timeout=20,
    ):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Speech server stopped.")
