// Render the exact Omarchy U+F09D1 (Material Design Icons brain) glyph.
// Source: CaskaydiaMonoNerdFont-Regular.ttf, SHA-256 below. Only the rendered
// glyph is bundled; the installed font is not required by PAIN at runtime.
// Usage: swift scripts/render-tray-icon.swift <source-font.ttf> <tray-brain.png>
import Foundation
import CoreText
import CoreGraphics
import CryptoKit
import ImageIO

guard CommandLine.arguments.count == 3 else {
    fatalError("Expected a source font and output PNG path")
}
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let fontData = try Data(contentsOf: source)
let digest = SHA256.hash(data: fontData).map { String(format: "%02x", $0) }.joined()
guard digest == "3076cdde3a97bfa2c7c389efc8ca57e6f68d8b406c95cae460549058bf2c5622" else {
    fatalError("Use the recorded CaskaydiaMono Nerd Font source to preserve the glyph")
}
guard let provider = CGDataProvider(data: fontData as CFData), let graphicsFont = CGFont(provider) else {
    fatalError("Cannot read source font")
}
let font = CTFontCreateWithGraphicsFont(graphicsFont, 36, nil, nil)
let characters = Array("\u{F09D1}".utf16)
var glyphs = [CGGlyph](repeating: 0, count: characters.count)
CTFontGetGlyphsForCharacters(font, characters, &glyphs, characters.count)
let mapped = glyphs.filter { $0 != 0 }
guard mapped.count == 1, let path = CTFontCreatePathForGlyph(font, mapped[0], nil) else {
    fatalError("Source font does not contain the Omarchy brain glyph")
}

// tray-icon displays the image at 18 logical points on macOS. Supply 2x pixels
// with a one-point transparent margin, preserving the original glyph's aspect.
let pixels = 36
let bounds = path.boundingBoxOfPath
let scale = 32 / max(bounds.width, bounds.height)
guard let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
                              bytesPerRow: pixels * 4, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("Cannot allocate template image")
}
context.clear(CGRect(x: 0, y: 0, width: pixels, height: pixels))
context.setShouldAntialias(true)
context.translateBy(x: (36 - bounds.width * scale) / 2 - bounds.minX * scale,
                    y: (36 - bounds.height * scale) / 2 - bounds.minY * scale)
context.scaleBy(x: scale, y: scale)
context.addPath(path)
context.setFillColor(CGColor(gray: 0, alpha: 1))
context.fillPath()
guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(output as CFURL, "public.png" as CFString, 1, nil) else {
    fatalError("Cannot create PNG")
}
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Cannot write PNG") }
print("Rendered U+F09D1 from \(CTFontCopyPostScriptName(font)): \(pixels)×\(pixels) RGBA template")
