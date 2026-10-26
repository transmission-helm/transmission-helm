cask "transmission-helm" do
  version "0.1.0"
  sha256 "7122f1d8f10c7f03eeee0baed08a8d79b87db7b18b2dbbd74c6ed6523905b466"

  url "https://github.com/transmission-helm/transmission-helm/releases/download/v#{version}/transmission-helm-#{version}-mac-arm64.zip"
  name "Transmission Helm"
  desc "Desktop client for the Transmission BitTorrent daemon"
  homepage "https://github.com/transmission-helm/transmission-helm"

  depends_on arch: :arm64
  depends_on macos: :ventura

  app "Transmission Helm.app"

  zap trash: [
    "~/Library/Application Support/Transmission Helm",
    "~/Library/Preferences/app.transmissionhelm.desktop.plist",
    "~/Library/Saved Application State/app.transmissionhelm.desktop.savedState",
  ]
end
