# Experimental Oculus Rift USB Driver

This implements a simple, hacky Oculus Rift dev kit driver in pure Javascript using the chrome.usb APIs. It only runs on Chrome, and only within a Packaged App.

## Preparing the Device

Unfortunately the Rift exposes itself as a HID device and operating systems prevent Chrome from using them. Hopefully future versions of Chrome will expose a HID API that allows easy access to these devices, but for now you must disable the built-in operating system HID control of the device. Once you do this the Rift will not be usable by the official Rift SDK until you disable the hacks.

### Windows

I've been unable to find a way to treat the Rift as a generic USB device. Until Chrome has a native HID API it may remain inaccessible. If you know a workaround please let me know!

### OS X

A codeless kernel extension is required to disable the system HID drivers from taking control of the Rift and preventing its use in Chrome. This extension is safe as it contains no code and is specified to only the Rift dev kit.

Installing:

* Unplug your Rift from USB
* Execute `sudo ./experimental/install-usb-hack.sh`
* Plug your Rift back in

To verify it worked run `ioreg -b -f | grep -n5 Tracker` and ensure that it does not have an HID interfaces nested underneath it. You should see output similar to the following:

```
+-o Tracker DK@14200000  <class IOUSBDevice, id 0x100000583, registered, matched, active, busy 0 (61 ms), retain 11>
  +-o AppleUSBComposite  <class AppleUSBComposite, id 0x100000586, !registered, !matched, active, busy 0, retain 4>
  +-o IOUSBInterface@0  <class IOUSBInterface, id 0x10000058a, registered, matched, active, busy 0 (11 ms), retain 10>
    +-o IOService  <class IOService, id 0x10000058d, !registered, !matched, active, busy 0, retain 4>
```

To uninstall, execute `sudo ./experimental/uninstall-usb-hack.sh`.

### Linux

A custom device rule that acts to unbind the Rift from the USB HID driver every time its plugged in is required.

* Unplug your Rift from USB
* `sudo nano /lib/udev/rules.d/40-oculus.rules`
* Add the following contents to the file:
```
SUBSYSTEM=="usb", ATTR{idVendor}=="2833", ATTRS{idProduct}=="0001", MODE="0664", GROUP="plugdev", PROGRAM="/bin/sh -c 'echo -n $id:1.0 >/sys/bus/usb/drivers/usbhid/unbind'"
```
* `sudo service udev restart`
* Plug your Rift back in

To verify it worked run `usb-devices`, look for the 'Tracker', and confirm that `Driver=(none)`.

To uninstall simply delete the `/lib/udev/rules.d/40-oculus.rules` file and restart the udev service.
