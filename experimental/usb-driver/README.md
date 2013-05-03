# Experimental Oculus Rift USB Driver

This implements a simple, hacky Oculus Rift dev kit driver in pure Javascript using the chrome.usb APIs. It only runs on Chrome, and only within a Packaged App.

## Preparing the Device

Unfortunately the Rift exposes itself as a HID device and operating systems prevent Chrome from using them. Hopefully future versions of Chrome will expose a HID API that allows easy access to these devices, but for now you must disable the built-in operating system HID control of the device. Once you do this the Rift will not be usable by the official Rift SDK until you disable the hacks.

### Windows

I've been unable to find a way to treat the Rift as a generic USB device. Until Chrome has a native HID API it may remain inaccessible. If you know a workaround please let me know!

### OS X

A codeless kernel extension is required to disable the system HID drivers from taking control of the Rift and preventing its use in Chrome. This extension is safe as it contains no code and is specified to only the Rift dev kit.

Installing:

* Execute `sudo ./experimental/install-usb-hack.sh`

Uninstalling:

* Execute `sudo ./experimental/uninstall-usb-hack.sh`

### Linux

A custom device rule that acts to unbind the Rift from the USB HID driver every time its plugged in is required.

Installing:

* Execute `sudo ./experimental/install-usb-hack.sh`

Uninstalling:

* Execute `sudo ./experimental/uninstall-usb-hack.sh`
