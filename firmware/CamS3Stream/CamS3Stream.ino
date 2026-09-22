#include <WiFi.h>
#include "esp_camera.h"
#include <lwip/sockets.h>
#include <errno.h>
#include <stdarg.h>

// Diagnostics must never hold up capture when the USB host stops reading.
static void diagnostic(const char *format, ...) {
    char message[192];
    va_list args;
    va_start(args, format);
    int n = vsnprintf(message, sizeof(message), format, args);
    va_end(args);
    if (n <= 0) return;
    size_t count = min(size_t(n), sizeof(message) - 1);
    if (Serial && Serial.availableForWrite() >= int(count))
        Serial.write(reinterpret_cast<const uint8_t *>(message), count);
}

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

WiFiServer server(80);

static bool cameraReady = false;

#define PWDN_GPIO_NUM  -1
#define RESET_GPIO_NUM 21
#define XCLK_GPIO_NUM  11
#define SIOD_GPIO_NUM  17
#define SIOC_GPIO_NUM  41

#define Y9_GPIO_NUM    13
#define Y8_GPIO_NUM    4
#define Y7_GPIO_NUM    10
#define Y6_GPIO_NUM    5
#define Y5_GPIO_NUM    7
#define Y4_GPIO_NUM    16
#define Y3_GPIO_NUM    15
#define Y2_GPIO_NUM    6
#define VSYNC_GPIO_NUM 42
#define HREF_GPIO_NUM  18
#define PCLK_GPIO_NUM  12
#define LED_GPIO_NUM   14

void setup()
{
    Serial.begin(115200);
    const uint32_t serialStarted = millis();
    while (!Serial && millis() - serialStarted < 1500) delay(10);
    Serial.setDebugOutput(false);
    Serial.setTxTimeoutMs(0);
    diagnostic("\n");

    camera_config_t config = {};
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;
    config.pin_d0       = Y2_GPIO_NUM;
    config.pin_d1       = Y3_GPIO_NUM;
    config.pin_d2       = Y4_GPIO_NUM;
    config.pin_d3       = Y5_GPIO_NUM;
    config.pin_d4       = Y6_GPIO_NUM;
    config.pin_d5       = Y7_GPIO_NUM;
    config.pin_d6       = Y8_GPIO_NUM;
    config.pin_d7       = Y9_GPIO_NUM;
    config.pin_xclk     = XCLK_GPIO_NUM;
    config.pin_pclk     = PCLK_GPIO_NUM;
    config.pin_vsync    = VSYNC_GPIO_NUM;
    config.pin_href     = HREF_GPIO_NUM;
    config.pin_sccb_sda = SIOD_GPIO_NUM;
    config.pin_sccb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn     = PWDN_GPIO_NUM;
    config.pin_reset    = RESET_GPIO_NUM;
    config.xclk_freq_hz = 20000000;
    config.frame_size   = FRAMESIZE_VGA;
    config.pixel_format = PIXFORMAT_JPEG;
    config.grab_mode    = CAMERA_GRAB_LATEST;
    config.fb_location  = CAMERA_FB_IN_PSRAM;
    config.jpeg_quality = 14;
    config.fb_count     = 2;

    if (!psramFound()) {
        diagnostic("Camera init FAILED: PSRAM unavailable\n");
        return;
    }

    // camera init
    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        diagnostic("Camera init FAILED: 0x%x\n", err);
        return;
    }

    sensor_t* s = esp_camera_sensor_get();
    diagnostic("Camera init OK; sensor PID: 0x%04x; PSRAM: %u bytes\n", s->id.PID, ESP.getPsramSize());
    cameraReady = true;
    camera_fb_t *testFrame = esp_camera_fb_get();
    if (!testFrame || !testFrame->buf || testFrame->len < 4 || testFrame->format != PIXFORMAT_JPEG || testFrame->buf[0] != 0xff || testFrame->buf[1] != 0xd8) {
        diagnostic("Frame capture FAILED (startup)\n");
    } else {
        diagnostic("Frame captured: %u bytes (startup)\n", unsigned(testFrame->len));
    }
    if (testFrame) esp_camera_fb_return(testFrame);
    // initial sensors are flipped vertically and colors are a bit saturated
    if (s->id.PID == OV3660_PID) {
        s->set_vflip(s, 1);        // flip it back
        s->set_brightness(s, 1);   // up the brightness just a bit
        s->set_saturation(s, -2);  // lower the saturation
    }

    WiFi.setAutoReconnect(true);
    WiFi.begin(ssid, password);
    WiFi.setSleep(false);

    diagnostic("WiFi connecting");
    uint32_t wifiAttempt = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - wifiAttempt >= 20000) {
            diagnostic("\nWiFi retry\n");
            WiFi.disconnect();
            WiFi.begin(ssid, password);
            WiFi.setSleep(false);
            wifiAttempt = millis();
        }
        delay(500);
        diagnostic(".");
    }
    diagnostic("\n");
    diagnostic("WiFi connected\n");

    diagnostic("IP address: ");
    diagnostic("%s\n", WiFi.localIP().toString().c_str());
    server.begin();
    diagnostic("Stream URL: http://%s/\n", WiFi.localIP().toString().c_str());
}

// One active stream, plus one bounded request parser. A new valid stream
// replaces the old stream; speculative browser connections cannot hold it hostage.
WiFiClient activeClient, pendingClient;
String requestHeaders;
uint32_t requestStarted = 0, lastFrameAt = 0, lastFrameLog = 0;
unsigned frameCount = 0, captureFailures = 0;

static bool sendBytes(WiFiClient &client, const uint8_t *data, size_t length) {
    const uint32_t started = millis();
    uint32_t progress = started;
    const int socket = client.fd();
    while (length && socket >= 0 && millis() - started < 4000 && millis() - progress < 2000) {
        // NetworkClient::write has its own retry loop, which can outlive our deadline.
        int sent = ::send(socket, data, min(length, size_t(4096)), MSG_DONTWAIT);
        if (sent > 0) {
            data += sent; length -= sent; progress = millis();
        } else if (sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) {
            delay(2);
        } else break;
    }
    if (length) diagnostic("Socket send incomplete: %u bytes remaining, %u ms, errno %d\n", unsigned(length), unsigned(millis() - started), errno);
    return length == 0;
}
static bool sendText(WiFiClient &client, const char *text) {
    return sendBytes(client, reinterpret_cast<const uint8_t *>(text), strlen(text));
}
static void disconnectStream() {
    activeClient.stop();
    diagnostic("Client disconnected\n");
}

void loop() {
    if (!cameraReady) { delay(100); return; }
    static bool wifiWasConnected = true;
    static uint32_t lastReconnect = 0;
    if (WiFi.status() != WL_CONNECTED) {
        if (wifiWasConnected) {
            activeClient.stop(); pendingClient.stop(); frameCount = 0;
            diagnostic("WiFi disconnected; stream stopped\n");
            wifiWasConnected = false;
        }
        if (millis() - lastReconnect >= 15000) {
            lastReconnect = millis(); WiFi.reconnect();
        }
        delay(20); return;
    }
    if (!wifiWasConnected) {
        wifiWasConnected = true; server.begin();
        diagnostic("WiFi reconnected; stream URL: http://%s/stream\n", WiFi.localIP().toString().c_str());
    }
    if (!pendingClient && server.hasClient()) {
        pendingClient = server.accept();
        pendingClient.setTimeout(1000);
        pendingClient.setNoDelay(true);
        requestHeaders = "";
        requestStarted = millis();
    }
    if (pendingClient) {
        // Limit both header bytes and parsing time, including idle preconnections.
        while (pendingClient.available() && requestHeaders.length() < 2048 && !requestHeaders.endsWith("\r\n\r\n")) {
            requestHeaders += char(pendingClient.read());
        }
        if (requestHeaders.endsWith("\r\n\r\n")) {
            bool stream = requestHeaders.startsWith("GET / HTTP/") || requestHeaders.startsWith("GET /stream HTTP/");
            if (stream) {
                if (activeClient) disconnectStream();
                activeClient = pendingClient;
                pendingClient = WiFiClient();
                diagnostic("Client connected\n");
                frameCount = 0;
                captureFailures = 0;
                if (!sendText(activeClient, "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=camframe\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n")) disconnectStream();
            } else {
                sendText(pendingClient, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                pendingClient.stop();
            }
        } else if (requestHeaders.length() >= 2048 || millis() - requestStarted > 2000) {
            pendingClient.stop();
        }
    }
    if (!activeClient.connected()) {
        if (frameCount) { disconnectStream(); frameCount = 0; }
        delay(2);
        return;
    }
    if (millis() - lastFrameAt < 100) { delay(2); return; }
    lastFrameAt = millis();
    const uint32_t captureStarted = millis();
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb || !fb->buf || fb->len < 4 || fb->format != PIXFORMAT_JPEG || fb->buf[0] != 0xff || fb->buf[1] != 0xd8) {
        if (fb) esp_camera_fb_return(fb);
        if (++captureFailures == 1 || captureFailures % 5 == 0) diagnostic("Frame capture FAILED\n");
        if (captureFailures >= 3) disconnectStream();
        return;
    }
    captureFailures = 0;
    if (frameCount < 3 || millis() - lastFrameLog >= 5000) {
        diagnostic("Frame captured: %u bytes, capture %u ms, RSSI %d dBm\n", unsigned(fb->len), unsigned(millis() - captureStarted), WiFi.RSSI());
        lastFrameLog = millis();
    }
    char part[100];
    snprintf(part, sizeof(part), "--camframe\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", unsigned(fb->len));
    bool sent = sendText(activeClient, part) && sendBytes(activeClient, fb->buf, fb->len) && sendText(activeClient, "\r\n");
    esp_camera_fb_return(fb);
    ++frameCount;
    if (!sent) { disconnectStream(); frameCount = 0; }
}
