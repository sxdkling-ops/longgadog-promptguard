# Demo video: shot list

About 75 seconds. Shows the real app working with the network off, and what runs locally. Fictional data only.

## Before you record (off camera)

1. Start the app: `cd desktop` then `npm start`. Wait for LonggaDog to show "on guard".
2. Warm up the local model: open http://127.0.0.1:8787/proof and press **Check on this device** once.
3. Open `demo/customers.csv` in Excel.
4. Keep the `demo` folder open in File Explorer (`medical-certificate.png`, `specimen-passport.png`).
5. Arrange the screen: Chrome on the Local proof page, Excel beside or behind it, LonggaDog visible.
6. Recorder: Snipping Tool (`Win + Shift + R`) or OBS, recording the whole screen so the mascot is in frame.
   Xbox Game Bar records one window only and would leave the mascot out.

## Shots

| Time | Do this | What the viewer sees | Say or caption |
|---|---|---|---|
| 0:00 | Press `Win + A` and turn on **Airplane mode**. Go to the Local proof page. | The banner at the top changes to **Network is off**. | "First, the network goes off." |
| 0:08 | In Excel, select the customer rows and press `Ctrl + C`. Click the text box on the proof page, clear it, press `Ctrl + V`. | Placeholders arrive instead of names, TINs and phone numbers. LonggaDog barks. | "Copy from Excel, paste into a browser. The sensitive parts never arrive." |
| 0:22 | Switch to Excel, click an empty cell, press `Ctrl + V`. | The original rows. | "Back in a trusted app, you get the original." |
| 0:30 | On the proof page, replace the box with a sentence that has a lowercase name, for example: `pa-follow up kay jun-jun bautista, overdue na siya`. Press **Check on this device**. | The name is replaced. "Where each step ran" shows Rules and Local LLM as **This PC** with timings, Cloud detector as **Nothing sent**, and the badge "Ran with the network off". (The **Taglish name** sample button fills this text in for you.) | "A lowercase Taglish name has no pattern. The local model catches it, on this PC." |
| 0:45 | Press **Check a file or image** and choose `medical-certificate.png`. | The image is read and comes back as redacted text: patient, age, diagnosis, phone, TIN. | "Images are read with local OCR." |
| 0:58 | Do the same with `specimen-passport.png`. | **Blocked**: identity documents are never sent. | "IDs are blocked outright." |
| 1:06 | Scroll to the top. | Network is off. Connections leaving this PC: 0. Local LLM: qwen2.5:3b. Local OCR: RapidOCR. | "Nothing left this machine. That is why it has to be local AI." |
| 1:12 | Turn Airplane mode off. End on LonggaDog. | | "PromptGuard PH. Local AI guarding cloud AI." |

## What each on-screen number means

- **Network is off** is a live test, repeated every three seconds: the page tries to reach a public address and
  fails. It is not a setting or a label.
- **Connections leaving this PC** is counted inside the gateway: every connection it opens to anything other than this
  machine. It covers the gateway process, not Ollama, which is a separate program that only serves the model locally.
- **Timings** are measured for that check on this hardware (Intel Core Ultra 5 235U, 32 GB RAM, no GPU).

## Checklist for the submission

- Rehearse once with Airplane mode on before recording. This flow has been tested with the network on, not off.
- No real names, IDs, keys or documents anywhere in frame, including browser tabs and notifications.
- If the bark is audible, list the recording under existing assets, or record your own.
- Upload so the link opens without a login.
