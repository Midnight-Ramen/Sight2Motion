# CamS3 MJPEG firmware

For M5Stack Unit CamS3-5MP, hardware revision 0x01. This is the tested standalone sketch; replace the two Wi-Fi placeholders locally before uploading. Do not commit your Wi-Fi credentials.

Board: M5UnitCAMS3. Enable USB CDC on boot and **OPI PSRAM**, not QSPI. Serial diagnostics use 115200 baud.

```powershell
arduino-cli compile --fqbn esp32:esp32:m5stack_unit_cams3:CDCOnBoot=cdc,PSRAM=opi firmware/CamS3Stream
arduino-cli upload -p COM16 --fqbn esp32:esp32:m5stack_unit_cams3:CDCOnBoot=cdc,PSRAM=opi firmware/CamS3Stream
```

Read the assigned IP from serial output. Both `http://<camera-ip>/` and `http://<camera-ip>/stream` serve VGA JPEG MJPEG with CORS enabled. Use one streaming client at a time. The IP may change after reconnecting to Wi-Fi.

Socket writes and USB logging are bounded to avoid stale clients or an absent serial reader blocking streaming. Wi-Fi recovery restarts the server after reconnection.

Validation on September 22, 2026: camera initialized with 8 MB PSRAM; 999 valid JPEG frames across six sequential stream tests, including disconnect/reconnect with serial closed. Firmware build and COM16 upload succeeded. Last observed URL: `http://10.0.5.17/stream`.
