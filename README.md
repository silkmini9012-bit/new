# 🚗 DriveLog — 테슬라 출발·주차 알림 + 주행 기록 (내 PC에서, 무료)

차가 **출발**하면, **주차**하면 휴대폰으로 알림이 오고, 경로·거리·배터리 사용량이 **내 PC에만** 저장돼요.
테슬라가 개인 개발자에게 매달 주는 무료 크레딧(약 14,000원) 안에서 돌아가요.

## 설치 (약 15~20분)
1. [Releases](https://github.com/silkmini9012-bit/new/releases/latest)에서 **`DriveLog-Setup.exe`** 를 받아 실행
   - "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**
2. 브라우저에 열리는 **설정 화면**을 위에서부터 따라 하기
   - Tailscale 로그인 (무료, 공유기 설정 대신)
   - 테슬라 개발자 앱 만들기 (복사 버튼으로 붙여 넣기만)
   - 테슬라 로그인 → 휴대폰으로 QR 찍어 가상 키 등록
   - 휴대폰에 ntfy 앱 설치 → 알림 구독
3. 휴대폰에 **`DriveLog.apk`** 설치 → 설정 화면 마지막 QR로 연결

## 알아 둘 것
- PC가 켜져 있어야 알림·기록이 작동해요. (Windows 시작 시 자동 실행)
- 데이터는 `%LOCALAPPDATA%\DriveLog\data` 에만 저장돼요. 다른 곳으로 보내지 않아요.
- 테슬라 무료 크레딧을 넘지 않도록 청구 한도를 작게(예: 10원) 설정하길 권해요.
- 본인 차량용 개인 도구예요. Tesla, Inc.와 관련 없는 비공식 프로그램이에요.

## 구조
| 폴더 | 내용 |
|---|---|
| `desktop/app` | 설정 화면, 알림, 주행 기록, 대시보드 (Node.js) |
| `desktop/tunnel` | Tailscale Funnel 내장 통로 (Go) |
| `desktop/ft-stubs` | 테슬라 fleet-telemetry를 Windows용으로 빌드하기 위한 패치 |
| `desktop/installer` | Windows 설치 프로그램 (Inno Setup) |
| `android` | 안드로이드 앱 |

모든 파일은 GitHub Actions가 자동으로 빌드해서 Releases에 올려요.
