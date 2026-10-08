# Test on a physical phone with Expo Go

Install Expo Go compatible with SDK 57. From the project folder:

```sh
npm ci
npm run mobile
```

Keep the terminal running and scan the **new** QR code in Expo Go. The mobile command explicitly selects Expo Go, clears Metro's cache, and starts a tunnel. The tunnel helper is a project development dependency, so Expo does not need to prompt for a global installation. The tunnel URL changes between sessions; old QR codes and old development-server history entries may no longer work.

For a faster connection on the same reachable Wi-Fi network, use `npm start` (LAN). For a browser, use `npm run web`. A manifest JSON response is Expo's native launch metadata, not an app crash report.

If Expo Go shows “Something went wrong”, expand its error log. A download/network error happens before app JavaScript starts; a runtime error needs the actual first error message. Do not disable the firewall to troubleshoot. Check a tunnel connection first. A successful bundle export or browser test alone does not prove physical-device startup.

The server must stay running, and the computer must remain awake. An Expo tunnel is a temporary development connection, not a production deployment.
