# Live Speech to Text setup

The phone streams microphone audio over your local Wi-Fi to the Vosk speech server on this computer. Vosk returns partial text while you are speaking. English works with the English model; Arabic is optional and requires its own model. This works with Expo Go and does not require an Apple Developer membership or a cloud transcription account.

## One-time Windows setup

Open PowerShell in this project folder and run:

```powershell
py -m venv .speech-venv
.\.speech-venv\Scripts\python.exe -m pip install -r requirements-speech.txt
New-Item -ItemType Directory -Force .\models | Out-Null
Invoke-WebRequest "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip" -OutFile .\vosk-model.zip
Expand-Archive .\vosk-model.zip -DestinationPath .\models -Force
Remove-Item .\vosk-model.zip
```

The English model download is about 40 MB. It runs locally on the computer after download.

### Optional Arabic model

To enable Arabic in the language selector, download the official Arabic Vosk model (about 318 MB):

```powershell
Invoke-WebRequest "https://alphacephei.com/vosk/models/vosk-model-ar-mgb2-0.4.zip" -OutFile .\vosk-ar-model.zip
Expand-Archive .\vosk-ar-model.zip -DestinationPath .\models -Force
Remove-Item .\vosk-ar-model.zip
```

The model recognizes Arabic and writes Arabic script. Accuracy can vary with dialect and recording conditions; this model is trained on the MGB-2 Arabic corpus.

## Each time you use Speech to Text

Start the speech server in one PowerShell window:

```powershell
cd "C:\Users\Yoga\SignBridge"
.\.speech-venv\Scripts\python.exe .\speech_server.py
```

Keep that window open. If Windows Firewall asks, allow Python on **Private networks**.

In a second PowerShell window, start the mobile app:

```powershell
cd "C:\Users\Yoga\SignBridge"
npx expo start --clear
```

Open the project in Expo Go on the iPhone. The iPhone and computer need to be on the same Wi-Fi. Tap the mic and allow microphone access. Partial text should appear while you speak; tap again to finish.

If Expo is using a tunnel or the speech server is on another computer, set `EXPO_PUBLIC_SPEECH_WS_URL` to `ws://COMPUTER_IP:8765` before starting Expo, replacing `COMPUTER_IP` with the computer's local Wi-Fi address.
