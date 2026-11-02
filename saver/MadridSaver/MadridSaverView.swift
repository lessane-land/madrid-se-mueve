import ScreenSaver
import WebKit

/// The macOS screen saver: Pulso from madrid.lessane.es in Modo pantalla.
/// `?pantalla` starts the page straight in screen mode, with no exit button and no cursor.
@objc(MadridSaverView)
final class MadridSaverView: ScreenSaverView {
    private static let page = URL(string: "https://madrid.lessane.es/?pantalla#pulso")!
    private var web: WKWebView?

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 1
        wantsLayer = true
        layer?.backgroundColor = NSColor(srgbRed: 0.04, green: 0.04, blue: 0.04, alpha: 1).cgColor

        let web = WKWebView(frame: bounds, configuration: WKWebViewConfiguration())
        web.autoresizingMask = [.width, .height]
        web.load(URLRequest(url: Self.page))
        addSubview(web)
        self.web = web

        // Since Sonoma the screen saver host keeps old instances alive after the saver stops,
        // each one still running the page. Leaving when the system says the saver stopped avoids that.
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(saverWillStop),
            name: Notification.Name("com.apple.screensaver.willstop"), object: nil)
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    @objc private func saverWillStop(_ note: Notification) {
        exit(0)
    }

    override var hasConfigureSheet: Bool { false }
    override var configureSheet: NSWindow? { nil }
}
