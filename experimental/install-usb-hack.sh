cp -r vr-js-usb-hack.kext vr-js-usb-hack.kext1
chown -R root:wheel vr-js-usb-hack.kext1
rm -rf /System/Library/Extensions/vr-js-usb-hack.kext
mv vr-js-usb-hack.kext1 /System/Library/Extensions/vr-js-usb-hack.kext
kextutil -t -v 6 /System/Library/Extensions/vr-js-usb-hack.kext/
touch /System/Library/Extensions/
