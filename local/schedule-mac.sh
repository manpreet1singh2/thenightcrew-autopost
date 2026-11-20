#!/bin/zsh
# Mac par roz 10:30 PM 5 AI videos + Facebook post ka schedule (launchd) banata hai.
# Chalao: zsh local/schedule-mac.sh        Hatana ho: zsh local/schedule-mac.sh remove
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.thenightcrew.autopost.video"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && { echo "❌ Node.js nahi mila. Pehle nodejs.org se install karo."; exit 1; }

if [ "$1" = "remove" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "Schedule hata diya."; exit 0
fi

mkdir -p "$DIR/local/videos" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-is</string>
    <string>$NODE</string><string>--env-file=.env</string><string>local/daily-video.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>22</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$DIR/local/videos/log.txt</string>
  <key>StandardErrorPath</key><string>$DIR/local/videos/log.txt</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✅ Roz 10:30 PM batch schedule set (5 videos raat bhar, posts agle din). Abhi test karna ho: launchctl kickstart gui/$(id -u)/$LABEL"
echo "   Log: $DIR/local/videos/log.txt"
