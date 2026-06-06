import ddddocr
import sys
import os

def solve(image_path):
    ocr = ddddocr.DdddOcr(show_ad=False)
    with open(image_path, 'rb') as f:
        image_bytes = f.read()
    result = ocr.classification(image_bytes)
    print(result, end='')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('', end='')
        sys.exit(1)
    solve(sys.argv[1])
