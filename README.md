# hunk-images

View old and new images inside `hunk diff`.

Requires **Hunk extension API 33** and OpenTUI 0.5.6 or later. Hunk 0.24.1 does not supply API 33. Use a Hunk build with `readBytes` support. Current Hunk source also includes a built-in image preview; this extension provides a separate Images view.

```sh
hunk extension install thiskevinwang/hunk-images
hunk diff
```

Select a PNG, JPEG, GIF, or WebP file. Press **F8**, or choose **View → File presentation → Images**. Press F8 again to return to the diff. Use **Apply “Images” to all matching files** in the View menu for multiple files.

Before and After appear side by side in wide panes and stacked in narrow panes. Added and deleted files show the available image. Each side comes from the exact review source, including commits and the Git index. Missing data is marked unavailable.

OpenTUI selects Kitty graphics when supported, with Sixel or colored text blocks as fallbacks. It controls image placement, clipping, and cleanup during scrolling. Images fit within 24 rows without cropping. GIF and WebP previews show a static frame. Files over 20 MiB or 40 million pixels are not displayed.

## Development

```sh
bun install
bun run typecheck
bun test
hunk diff --extension /absolute/path/to/hunk-images
```

Runtime dependencies are installed by Hunk. React, OpenTUI, and the extension API come from the host. The small API 33 type supplement can be removed when published Hunk types include `readBytes`.

The terminal test accepts an installed API 33 host, or a source checkout:

```sh
HUNK_SOURCE=/path/to/hunk bun run test:terminal
```

Verified against [Hunk source 39c03a8](https://github.com/modem-dev/hunk/tree/39c03a86d355b0e7b308ea8fa0f211274fb55468): 9 tests, TypeScript checks, and a PTY test for extension loading, F8, Kitty image output, resize, and image cleanup. The PTY test simulates terminal replies. Actual display in Rex has not been verified.

## References

- [Extension API](https://www.hunk.dev/docs/extend/extension-api/)
- [File previews](https://www.hunk.dev/docs/extend/file-previews/)
- [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/#display-images-on-screen)
