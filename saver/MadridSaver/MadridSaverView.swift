import ScreenSaver
import WebKit

/// The macOS screen saver: Pulso in Modo pantalla, for Madrid or the Bay Area.
/// `?pantalla` starts the page straight in screen mode, with no exit button and no cursor.
/// System Settings > Screen Saver > Options picks the city and the language.
@objc(MadridSaverView)
final class MadridSaverView: ScreenSaverView {
    private var web: WKWebView?
    private var sheet: NSWindow?
    private var cityPopUp: NSPopUpButton?
    private var languagePopUp: NSPopUpButton?

    private static let cities: [(title: String, host: String)] = [
        ("Madrid", "https://madrid.lessane.es/"),
        ("Bay Area", "https://bayarea.lessane.es/"),
    ]
    private static let languages: [(title: String, code: String)] = [
        ("Automatic", ""),
        ("Español", "es"),
        ("English", "en"),
    ]

    private var defaults: ScreenSaverDefaults? {
        ScreenSaverDefaults(forModuleWithName: Bundle(for: MadridSaverView.self).bundleIdentifier ?? "land.lessane.madridsaver")
    }

    private var page: URL {
        let city = min(max(defaults?.integer(forKey: "city") ?? 0, 0), Self.cities.count - 1)
        let language = min(max(defaults?.integer(forKey: "language") ?? 0, 0), Self.languages.count - 1)
        var address = Self.cities[city].host + "?pantalla"
        let code = Self.languages[language].code
        if !code.isEmpty { address += "&lang=" + code }
        return URL(string: address + "#pulso")!
    }

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 1
        wantsLayer = true
        layer?.backgroundColor = NSColor(srgbRed: 0.04, green: 0.04, blue: 0.04, alpha: 1).cgColor

        let web = WKWebView(frame: bounds, configuration: WKWebViewConfiguration())
        web.autoresizingMask = [.width, .height]
        web.load(URLRequest(url: page))
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

    // MARK: Options

    override var hasConfigureSheet: Bool { true }

    override var configureSheet: NSWindow? {
        if let sheet { return sheet }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 340, height: 170), styleMask: [.titled], backing: .buffered, defer: true)
        window.title = "Madrid se mueve"
        let content = NSView(frame: window.contentRect(forFrameRect: window.frame))

        func label(_ text: String, y: CGFloat) {
            let field = NSTextField(labelWithString: text)
            field.frame = NSRect(x: 20, y: y, width: 100, height: 22)
            field.alignment = .right
            content.addSubview(field)
        }
        func popUp(_ titles: [String], selected: Int, y: CGFloat) -> NSPopUpButton {
            let button = NSPopUpButton(frame: NSRect(x: 130, y: y - 2, width: 180, height: 26), pullsDown: false)
            button.addItems(withTitles: titles)
            button.selectItem(at: selected)
            content.addSubview(button)
            return button
        }

        label("City", y: 118)
        cityPopUp = popUp(Self.cities.map(\.title), selected: defaults?.integer(forKey: "city") ?? 0, y: 118)
        label("Language", y: 80)
        languagePopUp = popUp(Self.languages.map(\.title), selected: defaults?.integer(forKey: "language") ?? 0, y: 80)

        let done = NSButton(title: "Done", target: self, action: #selector(closeOptions))
        done.frame = NSRect(x: 230, y: 18, width: 90, height: 30)
        done.keyEquivalent = "\r"
        content.addSubview(done)

        window.contentView = content
        sheet = window
        return window
    }

    @objc private func closeOptions() {
        if let defaults {
            defaults.set(cityPopUp?.indexOfSelectedItem ?? 0, forKey: "city")
            defaults.set(languagePopUp?.indexOfSelectedItem ?? 0, forKey: "language")
            defaults.synchronize()
        }
        web?.load(URLRequest(url: page))
        if let sheet {
            if let parent = sheet.sheetParent { parent.endSheet(sheet) } else { sheet.close() }
        }
    }
}
