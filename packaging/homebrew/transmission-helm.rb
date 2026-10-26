cask "transmission-helm" do
  version "__VERSION__"
  sha256 "__SHA256_MAC_ZIP__"

  url "https://github.com/transmission-helm/transmission-helm/releases/download/v#{version}/transmission-helm-#{version}-mac-arm64.zip"
  name "Transmission Helm"
  desc "Desktop client for the Transmission BitTorrent daemon"
  homepage "https://github.com/transmission-helm/transmission-helm"

  depends_on arch: :arm64
  depends_on macos: ">= :sonoma"

  app "Transmission Helm.app"

  zap trash: [
    "~/Library/Application Support/Transmission Helm",
    "~/Library/Preferences/app.transmissionhelm.desktop.plist",
    "~/Library/Saved Application State/app.transmissionhelm.desktop.savedState",
  ]
end
