"""Build a flat, self-contained Super Productivity plugin ZIP."""

from pathlib import Path
import re
import zipfile


ROOT = Path(__file__).parent
SOURCE = ROOT / "src"
DIST = ROOT / "dist"


def build() -> Path:
    template = (SOURCE / "index.html").read_text(encoding="utf-8")
    core = (SOURCE / "board-core.js").read_text(encoding="utf-8")
    core = re.sub(r"^export \{ BoardCore \};\s*$", "", core, flags=re.MULTILINE)
    if "export { BoardCore }" in core:
        raise ValueError("BoardCore export was not removed from the iframe script")
    ui = (SOURCE / "board-ui.js").read_text(encoding="utf-8")
    style = (SOURCE / "style.css").read_text(encoding="utf-8")
    for content in (core, ui):
        if "</script" in content.lower():
            raise ValueError("Inline JavaScript contains a closing script tag")
    for marker in ("/* INLINE_CSS */", "/* INLINE_CORE */", "/* INLINE_UI */"):
        if template.count(marker) != 1:
            raise ValueError(f"Expected exactly one {marker} marker")
    html = (template.replace("/* INLINE_CSS */", style)
            .replace("/* INLINE_CORE */", core)
            .replace("/* INLINE_UI */", ui))
    files = {
        "manifest.json": (SOURCE / "manifest.json").read_bytes(),
        "plugin.js": (SOURCE / "plugin.js").read_bytes(),
        "index.html": html.encode("utf-8"),
    }
    DIST.mkdir(exist_ok=True)
    archive = DIST / "project-kanban.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as out:
        for name, contents in files.items():
            out.writestr(name, contents)
    return archive


if __name__ == "__main__":
    print(build())
