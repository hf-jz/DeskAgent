#!/bin/bash
# DeskApp macOS arm64 发布脚本（自签证书方案）
# 流程: build → electron-builder 无签名 dir → 自签 → 封装 dmg（含 install.command + 证书）
set -e
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export CSC_IDENTITY_AUTO_DISCOVERY=false
# run from the repo root regardless of where the script is invoked from
cd "$(dirname "$0")/.."

CERT="${CSC_NAME:-DeskApp Signing}"
REL=release
APP="$REL/mac-arm64/DeskApp.app"
DMG_STAGE=/tmp/deskapp-dmg-stage
DMG="$REL/DeskApp-0.1.0-arm64.dmg"

echo "== 1. build =="
npm run build 2>&1 | grep -E "error|✓ built" | head -2

echo "== 2. electron-builder 无签名 dir (arm64) =="
npx electron-builder --mac dir --arm64 -c.mac.identity=null 2>&1 | grep -E "packaging|skipped|error" | head -3

echo "== 3. 自签外层 (最小签名, 无 entitlements——子组件保持 electron-builder 原签名) =="
codesign --force -s "$CERT" "$APP"
codesign --verify --verbose=1 "$APP" 2>&1 | head -1 && echo "签名验证 OK"

echo "== 4. 准备 dmg 内容 =="
rm -rf "$DMG_STAGE" && mkdir -p "$DMG_STAGE"
cp -R "$APP" "$DMG_STAGE/"
# Applications 快捷方式（hdiutil 链接）
ln -sf /Applications "$DMG_STAGE/Applications"

# 导出签名证书（目标机信任用）
security find-certificate -c "$CERT" -p > "$DMG_STAGE/DeskApp-Signing.cer" 2>/dev/null

# 一键安装脚本
cat > "$DMG_STAGE/install.command" <<'INSTALL'
#!/bin/bash
# DeskApp 一键安装：拷贝到 /Applications + 信任签名证书 + 解除 quarantine
set -e
APP_NAME="DeskApp.app"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
CER="$SRC_DIR/DeskApp-Signing.cer"

echo "📦 正在安装 DeskApp 到 /Applications ..."
[ -d "/Applications/$APP_NAME" ] && rm -rf "/Applications/$APP_NAME"
cp -R "$SRC_DIR/$APP_NAME" /Applications/

if [ -f "$CER" ]; then
  echo "🔑 导入并信任签名证书（需要输入管理员密码）..."
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CER" 2>/dev/null || \
    sudo security add-trusted-cert -d -r trustAsRoot -k /Library/Keychains/System.keychain "$CER"
fi

echo "🧹 解除 quarantine 属性..."
xattr -dr com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true

echo "✅ 安装完成，正在启动 DeskApp ..."
open "/Applications/$APP_NAME"
INSTALL
chmod +x "$DMG_STAGE/install.command"

echo "== 5. 封装 dmg =="
rm -f "$DMG"
hdiutil create -volname "DeskApp" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG" 2>&1 | tail -1
rm -rf "$DMG_STAGE"
echo "✅ 完成: $DMG"
ls -la "$DMG" | awk '{print $5, $9}'
