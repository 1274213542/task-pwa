from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REFERENCE = Path('/tmp/codex-remote-attachments/019f6aaf-6257-7fe3-8983-40abdf7de072/EE34FA67-9FD8-4F3D-9479-5348D8ED02DA/3-照片-3.jpg')

ref = Image.open(REFERENCE).convert('RGB')
# Measured inner phone viewport from the supplied 1026 × 1280 reference.
ref = ref.crop((284, 157, 742, 1184)).resize((390, 844), Image.Resampling.LANCZOS)
ref.save(ROOT / 'screenshots/mobile-today-reference.png')

impl = Image.open(ROOT / 'screenshots/mobile-today-final.png').convert('RGB')
canvas = Image.new('RGB', (812, 892), '#e8e8e8')
canvas.paste(ref, (10, 38))
canvas.paste(impl, (412, 38))
draw = ImageDraw.Draw(canvas)
draw.text((10, 10), 'REFERENCE · measured crop', fill='#111')
draw.text((412, 10), 'IMPLEMENTATION · 390 x 844', fill='#111')
canvas.save(ROOT / 'screenshots/mobile-today-comparison-final.png')

# 50% overlay for alignment checks.
overlay = Image.blend(ref, impl, .5)
overlay.save(ROOT / 'screenshots/mobile-today-overlay-final.png')

def compare(reference_path: Path, crop: tuple[int, int, int, int], impl_name: str, out_name: str):
    reference = Image.open(reference_path).convert('RGB').crop(crop)
    reference = reference.resize((390, 844), Image.Resampling.LANCZOS)
    implementation = Image.open(ROOT / 'screenshots' / impl_name).convert('RGB')
    board = Image.new('RGB', (812, 892), '#e8e8e8')
    board.paste(reference, (10, 38))
    board.paste(implementation, (412, 38))
    board_draw = ImageDraw.Draw(board)
    board_draw.text((10, 10), 'REFERENCE · measured crop', fill='#111')
    board_draw.text((412, 10), 'IMPLEMENTATION · 390 x 844', fill='#111')
    board.save(ROOT / 'screenshots' / out_name)

REF_DIR = Path('/tmp/codex-remote-attachments/019f6aaf-6257-7fe3-8983-40abdf7de072/EE34FA67-9FD8-4F3D-9479-5348D8ED02DA')
compare(REF_DIR / '1-照片-1.jpg', (283, 156, 744, 1154), 'mobile-plan-month-final.png', 'mobile-plan-month-comparison-final.png')
compare(REF_DIR / '2-照片-2.jpg', (286, 182, 742, 1168), 'mobile-plan-week-final.png', 'mobile-plan-week-comparison-final.png')
