# Mindustry auf dem Raspberry Pi

Dieses Paket macht aus deinem Raspberry Pi zwei Dinge gleichzeitig:

1. **Einen echten Mindustry-Multiplayer-Server** (aktuelles Mindustry v8, Port 6567) —
   dafür brauchen die Mitspieler das kostenlose Spiel auf Mac/PC/Handy.
2. **Eine Webseite** (Port 80): Wer im lokalen Netzwerk `http://<pi-ip>` in Safari öffnet,
   kann sofort **Mindustry Classic** (die Original-Version von 2018) im Browser spielen
   und sieht die Anleitung, wie man dem Multiplayer-Server beitritt.

> **Warum nicht das aktuelle Mindustry im Browser?**
> Das aktuelle Mindustry ist ein Java-Programm ohne Web-Version, und sein Multiplayer
> läuft über TCP/UDP-Verbindungen, die Browser grundsätzlich nicht öffnen können.
> Eine Browser-Version mit Multiplayer existiert deshalb nicht — von niemandem.

## Voraussetzungen

- Raspberry Pi 3/4/5 mit **Raspberry Pi OS (64-bit)** und Netzwerkverbindung
- SSH-Zugang zum Pi (oder Tastatur+Monitor direkt am Pi)

## Installation (Schritt für Schritt)

**Schritt 1 — Per SSH auf den Pi** (Benutzername/Hostname ggf. anpassen;
Standard ist oft `pi@raspberrypi.local`):

```bash
ssh pi@raspberrypi.local
```

*Du solltest sehen:* die Eingabeaufforderung des Pi, z. B. `pi@raspberrypi:~ $`.

**Schritt 2 — Dieses Repo auf den Pi holen:**

```bash
git clone https://github.com/Sacul518/mindustry-pi.git
```

*Du solltest sehen:* `Cloning into 'mindustry-pi'...` und ein paar Fortschrittszeilen.

**Schritt 3 — Installations-Skript starten:**

```bash
cd mindustry-pi
sudo bash install.sh
```

*Du solltest sehen:* fünf Schritte laufen durch, am Ende ein Block mit
`Fertig!` und der IP-Adresse deines Pi. Das dauert beim ersten Mal ein paar
Minuten (Java wird installiert).

**Schritt 4 — Testen.** Auf einem beliebigen Gerät im selben WLAN in Safari öffnen:

```
http://<die-IP-aus-Schritt-3>
```

*Du solltest sehen:* die Seite „Mindustry auf dem Pi" mit einem gelben
Start-Button für die Browser-Version.

**Schritt 5 — Multiplayer beitreten.** Auf Mac/PC/Handy das kostenlose Spiel
installieren (Links stehen auf der Webseite), dann im Spiel:
**Spielen → Mehrspieler → Server hinzufügen** → `<pi-ip>:6567` eintragen.

*Du solltest sehen:* den Server in der Liste, mit Karte und Spielerzahl. Draufklicken → du bist drin.

## Verwaltung des Servers

| Was | Befehl (auf dem Pi) |
|---|---|
| Status ansehen | `sudo systemctl status mindustry-server` |
| Live-Log ansehen | `sudo journalctl -u mindustry-server -f` |
| Neu starten (neue Karte) | `sudo systemctl restart mindustry-server` |
| Stoppen | `sudo systemctl stop mindustry-server` |

Spielstände und Einstellungen des Servers liegen in `/opt/mindustry/config/`.

**Server-Befehle eingeben** (Karte wechseln, Admins setzen usw.): Der Dienst hat
keine Eingabe-Konsole. Dafür den Dienst kurz stoppen und den Server einmal von
Hand starten — dann hast du die interaktive Konsole (Befehl `help` zeigt alles):

```bash
sudo systemctl stop mindustry-server
sudo -u mindustry java -jar /opt/mindustry/server-release.jar host
# ... zum Beenden: Befehl "exit", danach:
sudo systemctl start mindustry-server
```

## Wichtig: Version muss zusammenpassen

Mindustry lässt nur Clients mit **derselben Version** auf den Server. Dieses Paket
enthält **v8 Build 158.1**. Wenn das Spiel auf euren Geräten mal neuer ist:
neue `server-release.jar` von https://github.com/Anuken/Mindustry/releases laden und auf dem Pi ersetzen:

```bash
sudo cp server-release.jar /opt/mindustry/server-release.jar
sudo systemctl restart mindustry-server
```

## Was liegt wo in diesem Paket?

```
mindustry-pi/
├── install.sh                     # Einrichtungs-Skript (auf dem Pi ausführen)
├── nginx-mindustry.conf           # Webserver-Konfiguration (Port 80)
├── server/                        # Hierhin lädt install.sh den offiziellen
│                                  #   Server (server-release.jar) von GitHub
├── systemd/mindustry-server.service  # Startet den Server automatisch beim Booten
└── web/                           # Die Webseite
    ├── index.html                 # Startseite mit Anleitung
    └── classic/                   # Mindustry Classic (HTML5, spielbar im Browser)
```

Die `server-release.jar` liegt bewusst nicht im Repo — `install.sh` lädt sie
beim Einrichten direkt von den offiziellen
[Mindustry-Releases](https://github.com/Anuken/Mindustry/releases) herunter.

## Credits & Lizenz

Dieses Repo ist nur die „Verpackung" (Installations-Skript, Konfiguration,
Startseite). Das Spiel selbst stammt komplett von anderen:

- **[Mindustry](https://github.com/Anuken/Mindustry)** und
  **[Mindustry Classic](https://anuke.itch.io/mindustry-classic)** sind von
  **[Anuken](https://github.com/Anuken)** (Anthony Vecchiato) — danke für
  dieses großartige Open-Source-Spiel! Wenn es dir gefällt:
  [kauf es auf Steam/itch.io](https://anuke.itch.io/mindustry) oder
  [unterstütze Anuken](https://github.com/sponsors/Anuken).
- Die spielbaren Browser-Dateien von Mindustry Classic (Ordner `web/classic/`)
  stammen aus dem Mirror
  **[minidogg/MindustryClassicMirror](https://github.com/minidogg/MindustryClassicMirror)**
  von **[minidogg](https://github.com/minidogg)**.

Mindustry ist unter der **GPL v3** lizenziert; dieses Repo steht deshalb
ebenfalls unter GPL v3 (siehe [LICENSE](LICENSE)). Gedacht für den privaten
Gebrauch im eigenen lokalen Netzwerk.
