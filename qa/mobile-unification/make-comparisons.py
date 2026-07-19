from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = Path(
    "/tmp/codex-remote-attachments/019f6aaf-6257-7fe3-8983-40abdf7de072/"
    "D631D0C3-EB3D-4E28-B314-567DA4C9029A"
)
VIEWPORT = (390, 844)


def normalize(path: Path) -> Image.Image:
    """Normalize the supplied iPhone capture without changing its proportions."""
    return ImageOps.fit(
        Image.open(path).convert("RGB"),
        VIEWPORT,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )


def make_board(source_name: str, implementation_name: str, output_name: str) -> None:
    source = normalize(SOURCE_ROOT / source_name)
    implementation = normalize(ROOT / implementation_name)

    board = Image.new("RGB", (812, 886), "#E7E8E5")
    board.paste(source, (10, 32))
    board.paste(implementation, (412, 32))

    draw = ImageDraw.Draw(board)
    draw.text((10, 10), "SOURCE · iPhone capture", fill="#111111")
    draw.text((412, 10), "IMPLEMENTATION · Browser Harness 390 × 844", fill="#111111")
    board.save(ROOT / output_name, optimize=True)


def make_focus_board(
    source_name: str,
    implementation_name: str,
    source_box: tuple[int, int, int, int],
    implementation_box: tuple[int, int, int, int],
    output_name: str,
) -> None:
    source = normalize(SOURCE_ROOT / source_name).crop(source_box)
    implementation = normalize(ROOT / implementation_name).crop(implementation_box)
    focus_size = (390, 520)
    source = ImageOps.fit(source, focus_size, method=Image.Resampling.LANCZOS)
    implementation = ImageOps.fit(implementation, focus_size, method=Image.Resampling.LANCZOS)

    board = Image.new("RGB", (812, 562), "#E7E8E5")
    board.paste(source, (10, 32))
    board.paste(implementation, (412, 32))
    draw = ImageDraw.Draw(board)
    draw.text((10, 10), "SOURCE · focused controls", fill="#111111")
    draw.text((412, 10), "IMPLEMENTATION · focused controls", fill="#111111")
    board.save(ROOT / output_name, optimize=True)


make_board("3-照片-3.jpg", "01b-tasks-composer-mobile.png", "compare-tasks.png")
make_board("4-照片-4.jpg", "02-plan-month-mobile.png", "compare-plan-month.png")
make_board("6-照片-6.jpg", "05-finance-mobile.png", "compare-finance.png")
make_focus_board(
    "3-照片-3.jpg",
    "01b-tasks-composer-mobile.png",
    (16, 150, 374, 625),
    (16, 92, 374, 610),
    "compare-tasks-focus.png",
)
make_focus_board(
    "4-照片-4.jpg",
    "02-plan-month-mobile.png",
    (16, 175, 374, 700),
    (16, 90, 374, 590),
    "compare-plan-month-focus.png",
)
make_focus_board(
    "6-照片-6.jpg",
    "05-finance-mobile.png",
    (16, 140, 374, 620),
    (16, 90, 374, 610),
    "compare-finance-focus.png",
)
