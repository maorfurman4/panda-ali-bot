#!/bin/zsh
# Usage: ./set-key.sh BOT_TOKEN   — asks for the value (hidden) and saves it into .env without printing it
umask 077
cd "${0:A:h}" || exit 1
key="$1"
[[ "$key" =~ '^[A-Z_]+$' ]] || { echo "❌ Invalid key name"; exit 1; }
grep -q "^$key=" .env || { echo "❌ Unknown key: $key"; exit 1; }
read -rs "value?הדבק את הערך של $key ולחץ Enter: "
echo
[[ -z "$value" ]] && { echo "❌ לא הוזן ערך"; exit 1; }
# Value goes through the environment (not argv, not sed) so special characters are kept literally.
KEY="$key" VALUE="$value" awk 'index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; next } { print }' .env > .env.tmp \
  && mv .env.tmp .env && echo "✅ $key נשמר"
