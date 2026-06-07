import ddddocr
import sys
import cv2
import numpy as np
from PIL import Image
import io

def solve(image_path):
    ocr = ddddocr.DdddOcr(show_ad=False)
    
    # 读取原图
    img = cv2.imread(image_path)
    
    strategies = []
    
    # 策略1：原图直接识别
    strategies.append(img)
    
    # 策略2：放大4倍 + 双三次插值
    h, w = img.shape[:2]
    strategies.append(cv2.resize(img, (w*4, h*4), interpolation=cv2.INTER_CUBIC))
    
    # 策略3：灰度 + 自适应二值化
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY, 11, 2)
    strategies.append(cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR))
    
    # 策略4：放大 + CLAHE对比度增强
    large = cv2.resize(img, (w*4, h*4), interpolation=cv2.INTER_CUBIC)
    gray_large = cv2.cvtColor(large, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    enhanced = clahe.apply(gray_large)
    strategies.append(cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR))
    
    # 策略5：去背景色（白色背景 + 蓝色文字提取）
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # 提取蓝色区域
    lower_blue = np.array([90, 50, 50])
    upper_blue = np.array([140, 255, 255])
    mask = cv2.inRange(hsv, lower_blue, upper_blue)
    # 反色（文字变黑，背景变白）
    result = cv2.bitwise_not(mask)
    large_result = cv2.resize(result, (w*4, h*4), interpolation=cv2.INTER_CUBIC)
    strategies.append(cv2.cvtColor(large_result, cv2.COLOR_GRAY2BGR))

    results = []
    for i, s in enumerate(strategies):
        try:
            # 转为 PNG bytes
            _, buf = cv2.imencode('.png', s)
            text = ocr.classification(buf.tobytes())
            text = ''.join(c for c in text if c.isalnum())
            if text:
                results.append(text)
                print(f"  策略{i+1}: {text}", file=sys.stderr)
        except Exception as e:
            print(f"  策略{i+1} 失败: {e}", file=sys.stderr)
    
    if not results:
        print('', end='')
        return
    
    # 投票：选出现次数最多的结果
    from collections import Counter
    voted = Counter(results).most_common(1)[0][0]
    print(f"  投票结果: {voted}", file=sys.stderr)
    print(voted, end='')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('', end='')
        sys.exit(1)
    solve(sys.argv[1])
