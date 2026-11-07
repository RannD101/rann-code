# Template formula Homebrew untuk Rann Code.
#
# NILAI RILIS: tiga nilai di bawah harus diisi oleh proses rilis.
# Jangan memakai checksum contoh. Hitung sha256 dari tarball npm yang
# benar-benar dipublikasikan:
#   curl -fsSL https://registry.npmjs.org/rann-code/-/rann-code-0.1.1.tgz -o rann-code.tgz
#   shasum -a 256 rann-code.tgz
#
# Setelah nilai rilis diisi, formula bisa diuji dengan:
#   brew install --build-from-source ./deploy/rann.rb
class Rann < Formula
  desc "Autonomous coding agent CLI dengan daemon persisten"
  homepage "https://github.com/RannD101/rann-code"
  url "URL_TARBALL_NPM_RANN_CODE"
  sha256 "SHA256_TARBALL_NPM_RANN_CODE"
  license "MIT"
  version "VERSI_RILIS_RANN_CODE"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rann --version")
  end
end
