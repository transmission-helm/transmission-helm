cask "transmission-helm" do
  version "0.1.0"
  sha256 "143ccbc4be28089a681daf1492b88d1614ebf71b4bc76fc317caf022672bb579"

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
