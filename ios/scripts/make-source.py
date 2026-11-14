#!/usr/bin/env python3
"""產生 SideStore／AltStore 的「來源」檔（R119）。

發佈時由 .github/workflows/ios.yml 執行，結果上傳到固定的 GitHub Release `ios-source`，
使用者在 SideStore 加入的來源網址永遠是同一個：
  https://github.com/<owner>/<repo>/releases/download/ios-source/sidestore-source.json

執行：python3 ios/scripts/make-source.py --repo MindGoGo/MultiView --version 0.1.0 \
        --ipa MultiView-iOS-0.1.0.ipa --notes ios/release-notes.txt --out sidestore-source.json
"""
import argparse
import json
import os
import re
from datetime import datetime, timezone

BUNDLE_ID = 'local.multiview.ios'
SOURCE_TAG = 'ios-source'
SOURCE_FILE = 'sidestore-source.json'
ICON_FILE = 'icon-1024.png'
MIN_OS = '17.0'
DESCRIPTION = '在一個畫面裡分割顯示多個直播與影片。'


def build_source(repo: str, version: str, ipa_name: str, ipa_size: int, notes: str, date: str) -> dict:
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        raise ValueError(f'repo 格式錯誤：{repo}')
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError(f'版本號格式錯誤：{version}')
    base = f'https://github.com/{repo}/releases/download'
    download_url = f'{base}/ios-v{version}/{ipa_name}'
    notes = notes.strip() or f'MultiView iOS {version}'
    return {
        'name': 'MultiView',
        'identifier': 'local.multiview.source',
        'sourceURL': f'{base}/{SOURCE_TAG}/{SOURCE_FILE}',
        'apps': [
            {
                'name': 'MultiView',
                'bundleIdentifier': BUNDLE_ID,
                'developerName': 'MultiView',
                'subtitle': '多畫面直播播放器',
                'localizedDescription': DESCRIPTION,
                'iconURL': f'{base}/{SOURCE_TAG}/{ICON_FILE}',
                'tintColor': '3D8BFD',
                'screenshotURLs': [],
                'versions': [
                    {
                        'version': version,
                        'date': date,
                        'localizedDescription': notes,
                        'downloadURL': download_url,
                        'size': ipa_size,
                        'minOSVersion': MIN_OS,
                    }
                ],
                'appPermissions': {'entitlements': [], 'privacy': {}},
                # 舊版 AltStore／SideStore 讀的欄位
                'version': version,
                'versionDate': date,
                'versionDescription': notes,
                'downloadURL': download_url,
                'size': ipa_size,
            }
        ],
        'news': [],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True, help='owner/repo')
    parser.add_argument('--version', required=True)
    parser.add_argument('--ipa', required=True, help='IPA 檔案的路徑')
    parser.add_argument('--notes', help='更新內容的文字檔')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    notes = ''
    if args.notes and os.path.exists(args.notes):
        with open(args.notes, encoding='utf-8') as f:
            notes = f.read()
    date = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    source = build_source(args.repo, args.version, os.path.basename(args.ipa), os.path.getsize(args.ipa), notes, date)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(source, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'已產生 {args.out}（{args.version}，{source["apps"][0]["size"]} bytes）')


if __name__ == '__main__':
    main()
