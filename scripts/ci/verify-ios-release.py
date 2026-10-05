#!/usr/bin/env python3
"""Check the actual exported IPA, not just Xcode's source configuration."""
import json
import plistlib
import re
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    roots = [name[:-len('Info.plist')] for name in archive.namelist()
             if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', name)]
    assert len(roots) == 1, 'Expected exactly one exported app'
    root = roots[0]
    info = plistlib.loads(archive.read(root + 'Info.plist'))
    assert info['CFBundleIdentifier'] == 'com.xpresstend.app', 'Wrong app identifier'
    assert str(info['CFBundleVersion']) == sys.argv[2], 'Wrong release build number'
    assert 'embedded.mobileprovision' in {name[len(root):] for name in archive.namelist() if name.startswith(root)}, 'Missing distribution provisioning profile'
    sdk = re.fullmatch(r'iphoneos(\d+)(?:\.\d+)*', info['DTSDKName'])
    assert sdk and int(sdk[1]) >= 26, 'App Store requires iOS SDK 26 or newer'
    assert not info.get('NSAppTransportSecurity', {}).get('NSAllowsArbitraryLoads', False), 'Insecure network configuration'
    privacy = plistlib.loads(archive.read(root + 'PrivacyInfo.xcprivacy'))
    assert privacy['NSPrivacyTracking'] is False, 'Unexpected tracking declaration'
    assert any(entry['NSPrivacyAccessedAPIType'] == 'NSPrivacyAccessedAPICategoryUserDefaults'
               and 'CA92.1' in entry['NSPrivacyAccessedAPITypeReasons']
               for entry in privacy['NSPrivacyAccessedAPITypes']), 'Missing Preferences required reason'
    config = json.loads(archive.read(root + 'capacitor.config.json'))
    assert config['appId'] == 'com.xpresstend.app', 'Wrong Capacitor app ID'
    assert not config.get('server', {}).get('url'), 'Remote development server cannot be published'
    print(json.dumps({'appId': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'],
                      'build': info['CFBundleVersion'], 'sdk': info['DTSDKName'], 'privacyManifest': 'verified'}))
