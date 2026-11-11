# hunk-images

View old and new images automatically in a bottom pane during `hunk diff`.

Supports **Hunk 0.24.1** with Git. No Hunk upgrade or source build required.

```sh
hunk extension install thiskevinwang/hunk-images
hunk diff
```

Select a PNG, JPEG, GIF, or WebP file. The image pane opens automatically. Select a text file and the pane disappears. Drag its divider to resize it. **F8** hides or shows the pane.

For an inline preview, choose **View → File presentation → Images**. Use **Apply “Images” to all matching files** in the View menu for multiple inline previews.

Before and After appear side by side in wide panes and stacked in narrow panes. Added and deleted files show the available image.

On 0.24.1, the extension reads Git objects identified by the reviewed patch. This supports working-tree changes, staged changes, and commit comparisons. A disk file is used only when its content matches the patch's object ID. Untracked images have no object ID; they show the current disk contents.

Missing objects, changed disk contents, and patches without object IDs show **unavailable**. This includes direct `--files` comparisons and pure renames without content changes on 0.24.1. The extension does not guess versions from `HEAD` or the current index. The automatic pane uses Git. The optional inline preview uses `readBytes()` when a newer host supplies it, including for non-Git sources.

OpenTUI selects Kitty graphics when supported, with Sixel or colored text blocks as fallbacks. It controls image placement, clipping, and cleanup. Images fit the pane without cropping; inline previews use at most 24 rows. GIF and WebP previews show a static frame. Files over 20 MiB or 40 million pixels are not displayed.

## Development

```sh
bun install
bun run typecheck
bun test
hunk diff --extension /absolute/path/to/hunk-images
```

Runtime dependencies are installed by Hunk. React, OpenTUI, and the extension API come from the host.

Run the terminal test against installed Hunk:

```sh
bun run test:terminal
bun run test:terminal --mode worktree
bun run test:terminal --mode untracked
bun run test:terminal --mode commits
```

The tests cover Git object reads, staged versus disk contents, commits, deletions, renames, untracked files, SHA-256 repositories, cancellation, file selection, and optional newer-host support. The PTY test checks automatic image output without input, F8 hide/show, resize, and cleanup in Hunk 0.24.1. Its default mode is staged. It simulates terminal replies. Actual display in Rex has not been verified. Set `HUNK_BIN=/path/to/hunk` to select an executable, or `HUNK_SOURCE=/path/to/hunk` to test a source checkout.

## References

- [Extension API](https://www.hunk.dev/docs/extend/extension-api/)
- [File previews](https://www.hunk.dev/docs/extend/file-previews/)
- [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/#display-images-on-screen)
