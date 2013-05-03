/**
 * vr.js experimental USB driver.
 *
 * @author Ben Vanik <ben.vanik@gmail.com>
 * @license BSD
 */


var assert = this.assert ||
    function() { console.assert.apply(console, arguments); };

startup();

function startup() {
  chrome.usb.findDevices({
    vendorId: TRACKER_DK_VENDOR_ID,
    productId: TRACKER_DK_PRODUCT_ID
  }, function(devices) {
    if (devices.length) {
      console.log('found ' + devices.length + ' devices');
      for (var n = 0; n < devices.length; n++) {
        queryDevice(devices[n]);
      }
    } else {
      console.log('no devices');
    }
  });
};

function getBcdString(value) {
  return (value >> 8) + '.' + String((value >> 4) & 0xF) + String(value & 0xF);
};

function ioctl_read(device, type, request, value, index, length, callback) {
  chrome.usb.controlTransfer(device, {
    requestType: type,
    recipient: 'device',
    direction: 'in',
    request: request,
    value: value,
    index: index,
    length: length
  }, function(info) {
    callback(
        info.resultCode,
        info.resultCode ? null : new Uint8Array(info.data));
  });
};


var HidDevice = function(device) {
  this.device_ = device;
};
HidDevice.prototype.getFeatureReport = function() {

};
HidDevice.prototype.setFeatureReport = function() {
};

function getDeviceString(device, index, callback) {
  ioctl_read(device, 'standard', 6, 0x0300 | index, 0, 256,
      function(resultCode, data) {
        if (resultCode) {
          callback(null);
        } else {
          // bLength / bDescriptorType / bString*
          var chars = new Array(data.length - 2);
          for (var n = 0; n < chars.length; n++) {
            chars[n] = data[n + 2];
          }
          var str = String.fromCharCode.apply(null, chars);
          str = str.trim();
          callback(str);
        }
      });
};

var EndpointDescriptor = function(data, o) {
  // http://www.beyondlogic.org/usbnutshell/usb5.shtml#EndpointDescriptors
  assert(data[o++] == EndpointDescriptor.LENGTH);       // bLength
  assert(data[o++] == EndpointDescriptor.TYPE);         // bDescriptorType
  this.endpointAddress = data[o++];                     // bEndpointAddress
  this.attributes = data[o++];                          // bmAttributes
  this.maxPacketSize = data[o++] | (data[o++] << 8);    // wMaxPacketSize
  this.interval = data[o++];                            // bInterval
};
EndpointDescriptor.LENGTH = 7;
EndpointDescriptor.TYPE = 5;

var HidDescriptor = function(data, o) {
  assert(data[o++] == HidDescriptor.LENGTH);            // bLength
  assert(data[o++] == HidDescriptor.TYPE);              // bDescriptorType
  this.hid = getBcdString(data[o++] | (data[o++] << 8)); // bcdHID
  this.countryCode = data[o++];                         // bCountryCode
  var descriptorCount = data[o++];                      // bNumDescriptors
  this.descriptorType = data[o++];                      // bDescriptorType
  this.descriptorLength = data[o++] | (data[o++] << 8); // bDescriptorLength
  // extra descriptors are type|length
  assert(descriptorCount == 1);
};
HidDescriptor.LENGTH = 9;
HidDescriptor.TYPE = 33;

var InterfaceDescriptor = function(data, o) {
  // http://www.beyondlogic.org/usbnutshell/usb5.shtml#InterfaceDescriptors
  assert(data[o++] == InterfaceDescriptor.LENGTH);      // bLength
  assert(data[o++] == InterfaceDescriptor.TYPE);        // bDescriptorType
  this.interfaceNumber = data[o++];                     // bInterfaceNumber
  this.alternateSetting = data[o++];                    // bAlternateSetting
  var endpointCount = data[o++];                        // bNumEndpoints
  this.interfaceClass = data[o++];                      // bInterfaceClass
  this.interfaceSubClass = data[o++];                   // bInterfaceSubClass
  this.interfaceProtocol = data[o++];                   // bInterfaceProtocol
  this.extraData_ = {
    interfaceIndex: data[o++]                           // iInterface
  };

  this.interfaceName = '';
  this.endpoints = [];

  this.hidDescriptor = null;
  if (this.interfaceClass == 3) {
    this.hidDescriptor = new HidDescriptor(data, o);
    o += HidDescriptor.LENGTH;
  }

  for (var n = 0; n < endpointCount; n++) {
    var endpointDesc = new EndpointDescriptor(data, o);
    this.endpoints.push(endpointDesc);
    o += EndpointDescriptor.LENGTH;
  }
};
InterfaceDescriptor.LENGTH = 9;
InterfaceDescriptor.TYPE = 4;

var ConfigurationDescriptor = function(data) {
  // http://www.beyondlogic.org/usbnutshell/usb5.shtml#ConfigurationDescriptors
  var o = 0;
  o++;                                                  // bLength
  assert(data[o++] == ConfigurationDescriptor.TYPE);    // bDescriptorType
  var totalLength = data[o++] | (data[o++] << 8);       // wTotalLength
  var interfaceCount = data[o++];                       // bNumInterfaces
  this.configurationValue = data[o++];                  // bConfigurationValue
  var configurationIndex = data[o++];                   // iConfiguration
  this.attributes = data[o++];                          // bmAttributes
  this.maxPower = data[o++];                            // bMaxPower

  this.extraData_ = {
    configurationIndex: configurationIndex
  };

  this.configurationName = '';
  this.interfaces = [];

  for (var n = 0; n < interfaceCount; n++) {
    var interfaceDesc = new InterfaceDescriptor(data, o);
    this.interfaces.push(interfaceDesc);
    o += InterfaceDescriptor.LENGTH +
        interfaceDesc.endpoints.length * EndpointDescriptor.LENGTH;
  }
};
ConfigurationDescriptor.TYPE = 2;
ConfigurationDescriptor.get = function(device, index, callback) {
  ioctl_read(device, 'standard', 6, 0x0200 | index, 0, 2048,
      function(resultCode, data) {
        if (resultCode) {
          console.log('unable to get ConfigurationDescriptor: ' + resultCode);
          callback(null);
          return;
        }

        var desc = new ConfigurationDescriptor(data);

        var remainingCount = 0;
        function finishCallback(successful) {
          if (!successful) {
            callback(null);
            remainingCount = 0;
            return;
          }
          remainingCount--;
          if (remainingCount == 0) {
            callback(desc);
          }
        };

        remainingCount += 1;
        getDeviceString(device, desc.extraData_.configurationIndex,
            function(str) {
              desc.configurationName = str || '';
              finishCallback(!!str);
            });

        remainingCount += desc.interfaces.length;
        desc.interfaces.forEach(function(interfaceDesc) {
          getDeviceString(device, interfaceDesc.extraData_.interfaceIndex,
              function(str) {
                interfaceDesc.interfaceName = str || '';
                finishCallback(!!str);
              });
        });
      });
};

var DeviceDescriptor = function(data) {
  // http://www.beyondlogic.org/usbnutshell/usb5.shtml#DeviceDescriptors
  var o = 0;
  o++;                                                  // bLength
  o++;                                                  // bDescriptorType
  this.usbVersion = getBcdString(data[o++] | (data[o++] << 8)); // bcdUSB
  this.deviceClass = data[o++];                         // bDeviceClass
  this.deviceSubClass = data[o++];                      // bDeviceSubClass
  this.deviceProtocol = data[o++];                      // bDeviceProtocol
  this.maxPacketSize = data[o++];                       // bMaxPacketSize
  this.vendorId = data[o++] | (data[o++] << 8);         // idVendor
  this.productId = data[o++] | (data[o++] << 8);        // idProduct
  this.deviceRelease = getBcdString(data[o++] | (data[o++] << 8)); // bcdDevice
  this.extraData_ = {
    manufacturerIndex: data[o++],                       // iManufacturer
    productIndex: data[o++],                            // iProduct
    serialNumberIndex: data[o++],                       // iSerialNumber
    configurationCount: data[o++]                       // bNumConfigurations
  };

  this.manufacturerName = '';
  this.productName = '';
  this.serialNumber = '';
  this.configurations = [];
};
DeviceDescriptor.SIZE = 18;
DeviceDescriptor.get = function(device, callback) {
  ioctl_read(device, 'standard', 6, 0x0100, 0, DeviceDescriptor.SIZE,
      function(resultCode, data) {
        if (resultCode) {
          console.log('unable to get DeviceDescriptor: ' + resultCode);
          callback(null);
          return;
        }

        var desc = new DeviceDescriptor(data);

        var remainingCount = 0;
        function finishCallback(successful) {
          if (!successful) {
            callback(null);
            remainingCount = 0;
            return;
          }
          remainingCount--;
          if (remainingCount == 0) {
            callback(desc);
          }
        };

        remainingCount += 3;
        getDeviceString(device, desc.extraData_.manufacturerIndex,
            function(str) {
              desc.manufacturerName = str || '';
              finishCallback(!!str);
            });
        getDeviceString(device, desc.extraData_.productIndex,
            function(str) {
              desc.productName = str || '';
              finishCallback(!!str);
            });
        getDeviceString(device, desc.extraData_.serialNumberIndex,
            function(str) {
              desc.serialNumber = str || '';
              finishCallback(!!str);
            });

        remainingCount += desc.extraData_.configurationCount;
        function configurationCallback(config) {
          if (config) {
            desc.configurations.push(config);
          }
          finishCallback(!!config);
        };
        for (var n = 0; n < desc.extraData_.configurationCount; n++) {
          ConfigurationDescriptor.get(device, n, configurationCallback);
        }
      });
};

function decodeUint16(data, offset) {
  return data[offset + 0] | (data[offset + 1] << 8);
};
function decodeInt16(data, offset) {
  var u = (data[offset + 1] << 8) | data[offset + 0];
  return u > 32768 - 1 ? u - 65536 : u;
};
function decodeUint32(data, offset) {
  return data[offset + 0] | (data[offset + 1] << 8) | (data[offset + 2] << 16) |
      (data[offset + 3] << 24);
};
var tempUint32 = new Uint32Array(1);
var tempFloat32 = new Float32Array(tempUint32.buffer);
function decodeFloat32(data, offset) {
  tempUint32[0] = decodeUint32(data, offset);
  return tempFloat32[0];
};

var HmdInfo = function(data) {
  var o = 0;
  this.commandId = data[o + 1] | (data[o + 2] << 8);
  this.distortionType = data[o + 3];
  this.resolutionHorz = decodeUint16(data, o + 4);
  this.resolutionVert = decodeUint16(data, o + 6);
  this.screenSizeHorz = decodeUint32(data, o + 8) *  (1/1000000);
  this.screenSizeVert = decodeUint32(data, o + 12) * (1/1000000);
  this.screenCenterVert = decodeUint32(data, o + 16) * (1/1000000);
  this.lensSeparation = decodeUint32(data, o + 20) * (1/1000000);
  this.eyeToScreenDistance = new Float32Array([
    decodeUint32(data, o + 24) * (1/1000000),
    decodeUint32(data, o + 28) * (1/1000000)
  ]);
  this.distortionK = new Float32Array([
    decodeFloat32(data, o + 32),
    decodeFloat32(data, o + 36),
    decodeFloat32(data, o + 40),
    decodeFloat32(data, o + 44),
    decodeFloat32(data, o + 48),
    decodeFloat32(data, o + 52)
  ]);
};
HmdInfo.get = function(device, deviceDesc, callback) {
  getFeatureReport(device, deviceDesc, 9, 56, function(data) {
    if (data) {
      callback(new HmdInfo(data));
    } else {
      callback(null);
    }
  });
};


var SensorRange = function(data) {
  var o = 0;
  this.commandId = data[o + 1] | (data[o + 2] << 8);
  this.accelScale = data[o + 3];
  this.gyroScale = decodeUint16(data, o + 4);
  this.magScale = decodeUint16(data, o + 6);
};
SensorRange.get = function(device, deviceDesc, callback) {
  getFeatureReport(device, deviceDesc, 4, 8, function(data) {
    if (data) {
      callback(new SensorRange(data));
    } else {
      callback(null);
    }
  });
};




function getFeatureReport(device, deviceDesc, reportId, length, callback) {
  var interfaceNumber = deviceDesc.configurations[0].interfaces[0].interfaceNumber;
  chrome.usb.controlTransfer(device, {
    requestType: 'class',
    recipient: 'interface',
    direction: 'in',
    request: 0x01,
    value: 0x0300 | reportId,
    index: interfaceNumber,
    length: length
  }, function(info) {
    if (info.resultCode) {
      callback(null);
      return;
    }
    callback(new Uint8Array(info.data));
  });
};

function setFeatureReport(device, deviceDesc, reportId, data, callback) {
  var interfaceNumber = deviceDesc.configurations[0].interfaces[0].interfaceNumber;
  chrome.usb.controlTransfer(device, {
    requestType: 'class',
    recipient: 'interface',
    direction: 'out',
    request: 0x09,
    value: 0x0300 | reportId,
    index: interfaceNumber,
    data: data.buffer
  }, function(info) {
    if (info.resultCode) {
      callback(false);
      return;
    }
    callback(true);
  });
};


function getSensorConfig(device, deviceDesc, callback) {
  getFeatureReport(device, deviceDesc, 2, 8, callback);
};

function setSensorConfig(device, deviceDesc, data, callback) {
  setFeatureReport(device, deviceDesc, 2, data, callback);
};


function setSensorKeepAlive(device, deviceDesc, intervalMs, callback) {
  var data = new Uint8Array(4);
  data[0] = 0;
  data[1] = 0;
  data[2] = intervalMs & 0xFF;
  data[3] = intervalMs >> 8;
  setFeatureReport(device, deviceDesc, 8, data, callback);
};



function queryDevice(device) {
  ioctl_read(device, 'standard', 0, 0, 0, 2, function(data) {
    console.log('status:', data);
  });

  ioctl_read(device, 'standard', 8, 0, 0, 1, function(data) {
    console.log('config:', data);
  });

  chrome.usb.resetDevice(device, function(info) {
    DeviceDescriptor.get(device, function(deviceDesc) {
      console.log(deviceDesc);
      chrome.usb.controlTransfer(device, {
        requestType: 'standard',
        recipient: 'device',
        direction: 'out',
        request: 9, // SET_CONFIGURATION
        value: deviceDesc.configurations[0].configurationValue,
        index: 0,
        data: new Uint8Array(0).buffer
      }, function(info) {
        if (info.resultCode) {
          console.log('unable to set configuration: ', info.resultCode);
          return;
        }
        console.log('config set');

        HmdInfo.get(device, deviceDesc, function(info) {
          console.log(info);
        });

        getSensorConfig(device, deviceDesc, function(data) {
          console.log('sensor config', data);
          // setSensorConfig(device, deviceDesc, data, function() {
          // });
        });

        SensorRange.get(device, deviceDesc, function(sensorRange) {
          console.log(sensorRange);
        });

        setSensorKeepAlive(device, deviceDesc, 10 * 1000, function(error) {
          console.log('keep alive set', error);
        });

        // get input report descriptor
        var interfaceNumber = deviceDesc.configurations[0].interfaces[0].interfaceNumber;
        var reportLength = deviceDesc.configurations[0].interfaces[0].hidDescriptor.descriptorLength;
        chrome.usb.controlTransfer(device, {
          requestType: 'standard',
          recipient: 'interface',
          direction: 'in',
          request: 0x06,
          value: 0x2200,
          index: interfaceNumber,
          length: reportLength
        }, function(info) {
          if (info.resultCode) {
            console.log('get report descriptor failed', info.resultCode);
            return;
          }
          var data = new Uint8Array(info.data);
          var reportDesc = new HidReportDescriptor(data);
          console.log(reportDesc);

          startInputPump(device, deviceDesc, reportDesc);
        });
      });
    });
  });
};

var lastKeepAliveTime = 0;

var HidReportDescriptor = function(data) {
  function readData(itemSize, data, o) {
    switch (itemSize) {
      case 0:
        return 0;
      case 1:
        return data[o];
      case 2:
        return decodeUint16(data, o);
      default:
        return data[o + 0] | (data[o + 1] << 8) | (data[o + 2] << 8);
    }
  };

  var stack = [];
  this.root = {};
  stack.push(this.root);
  var current = stack[0];
  var usagePage = 0;
  var usage = 0;
  var currentReport = null;
  var logicalMin = 0;
  var logicalMax = 0;
  var reportSize = 0;
  var reportCount = 0;
  var allReports = [];
  for (var o = 0; o < data.length;) {
    var b0 = data[o++];
    if (b0 == 0xFE) {
      // Long item.
      assert(false);
    } else {
      // Short item.
      var itemTag = b0 >> 4;
      var itemType = (b0 >> 2) & 0x3;
      var itemSize = b0 & 0x3;
      if (itemType == 0) {
        switch (itemTag) {
          case 0x8: // input
            console.log('input', itemSize);
            currentReport.inputs.push({
              usage: usage,
              logicalMin: logicalMin,
              logicalMax: logicalMax,
              reportSize: reportSize,
              reportCount: reportCount
            });
            break;
          case 0x9: // output
            console.log('output', itemSize);
            currentReport.outputs.push({
              usage: usage,
              logicalMin: logicalMin,
              logicalMax: logicalMax,
              reportSize: reportSize,
              reportCount: reportCount
            });
            break;
          case 0xB: // feature
            console.log('feature', itemSize);
            currentReport.features.push({
              usage: usage,
              logicalMin: logicalMin,
              logicalMax: logicalMax,
              reportSize: reportSize,
              reportCount: reportCount
            });
            break;
          case 0xA: // collection start
            var child = {
              reports: []
            };
            stack.push(child);
            var collectionType = data[o];
            var collectionName = collectionType.toString(16);
            switch (collectionType) {
              case 0x00: collectionName = 'physical'; break;
              case 0x01: collectionName = 'application'; break;
              case 0x02: collectionName = 'logical'; break;
              case 0x03: collectionName = 'report'; break;
              case 0x04: collectionName = 'namedArray'; break;
              case 0x05: collectionName = 'usageSwitch'; break;
              case 0x06: collectionName = 'usageModifier'; break;
            }
            console.log('collection', collectionName);
            current[collectionName] = child;
            current = child;
            break;
          case 0xC: // end collection
          console.log('end collection');
            current = stack.pop();
            break;
          default:
            console.log('unknown type 0', itemTag);
            break;
        }
      } else if (itemType == 1) {
        switch (itemTag) {
          case 0x0: // usage page
            usagePage = readData(itemSize, data, o);
            console.log('usage page', usagePage.toString(16));
            break;
          case 0x1: // logical minimum
            logicalMin = readData(itemSize, data, o);
            console.log('logical minimum', logicalMin);
            break;
          case 0x2: // logical maximum
            logicalMax = readData(itemSize, data, o);
            console.log('logical maximum', logicalMax);
            break;
          case 0x3: // physical minimum
            console.log('physical minimum', readData(itemSize, data, o));
            break;
          case 0x4: // physical maximum
            console.log('physical maximum', readData(itemSize, data, o));
            break;
          case 0x5: // unit exponent
            console.log('unit exponent', readData(itemSize, data, o));
            break;
          case 0x6: // unit
            console.log('unit', readData(itemSize, data, o));
            break;
          case 0x7: // report size
            reportSize = readData(itemSize, data, o);
            console.log('report size', reportSize);
            break;
          case 0x8: // report id
            console.log('report id', readData(itemSize, data, o));
            currentReport = {
              reportId: readData(itemSize, data, o),
              inputs: [],
              outputs: [],
              features: []
            };
            allReports.push(currentReport);
            current.reports.push(currentReport);
            break;
          case 0x9: // report count
            reportCount = readData(itemSize, data, o);
            console.log('report count', reportCount);
            break;
          case 0xA: // push
            console.log('push');
            break;
          case 0xB: // pop
            console.log('pop');
            break;
          default:
            console.log('unknown type 1', itemTag);
            break;
        }
      } else if (itemType == 2) {
        switch (itemTag) {
          case 0x0: // usage
            usage = (usagePage << 16) | readData(itemSize, data, o);
            console.log('usage', usage);
            break;
          case 0x1: // usage minimum
            console.log('usage minimum', readData(itemSize, data, o));
            break;
          case 0x2: // usage maximum
            console.log('usage maximum', readData(itemSize, data, o));
            break;
          case 0x3: // designator index
            console.log('designator index', readData(itemSize, data, o));
            break;
          case 0x4: // designator minimum
            console.log('usage minimum', readData(itemSize, data, o));
            break;
          case 0x5: // designator maximum
            console.log('usage maximum', readData(itemSize, data, o));
            break;
          case 0x7: // string index
            console.log('string index', readData(itemSize, data, o));
            break;
          case 0x8: // string minimum
            console.log('string minimum', readData(itemSize, data, o));
            break;
          case 0x9: // string maximum
            console.log('string maximum', readData(itemSize, data, o));
            break;
          case 0xA: // delimiter
            console.log('delimiter', readData(itemSize, data, o));
            break;
          default:
            console.log('unknown type 2', itemTag);
            break;
        }
      } else {
        console.log('unknown type ' + itemType);
      }
      o += itemSize;
    }
  }
  assert(stack.length == 1);

  for (var n = 0; n < allReports.length; n++) {
    var report = allReports[n];
    var totalSize = 0;
    for (var m = 0; m < report.inputs.length; m++) {
      var input = report.inputs[m];
      totalSize += (input.reportSize / 8) * input.reportCount;
    }
    report.totalSize = totalSize;
  }
};

function startInputPump(device, deviceDesc, reportDesc) {
  var interfaceNumber = deviceDesc.configurations[0].interfaces[0].interfaceNumber;
  chrome.usb.claimInterface(device, interfaceNumber, function() {
    console.log('interface claimed');

    var interfaceNumber = deviceDesc.configurations[0].interfaces[0].interfaceNumber;
    var endpointAddress = deviceDesc.configurations[0].interfaces[0].endpoints[0].endpointAddress;
    var inputReport = reportDesc.root.application.logical.reports[0];
    var reportSize = inputReport.totalSize + 1;

    var nn = 0;
    pumpInput(device, endpointAddress, reportSize, function(data) {
      //console.log('incoming data', !!data);

      if (!data) {
        chrome.usb.releaseInterface(device, interfaceNumber, function() {});
        return false;
      }

      function decodeSensorData(data, o) {
        var result = new Int32Array(3);
        result[0] = (data[o + 0] << 13) | (data[o + 1] << 5) | ((data[o + 2] & 0xF8) >> 3);
        result[1] = ((data[o + 2] & 0x07) << 18) | (data[o + 3] << 10) | (data[o + 4] << 2) |
                    ((data[o + 5] & 0xC0) >> 6);
        result[2] = ((data[o + 5] & 0x3F) << 15) | (data[o + 6] << 7) | (data[o + 7] >> 1);
        result[0] = ((result[0] << 11) >> 11);
        result[1] = ((result[1] << 11) >> 11);
        result[2] = ((result[2] << 11) >> 11);
        return result;
      };

      // TODO: prep data as in SensorDeviceImpl::onTrackerMessage
      // (float scaling/etc)

      var o = 0;
      // 0 = record id?
      var message = {
        sampleCount: data[o + 1],
        timestamp: decodeUint16(data, o + 2),
        lastCommandId: decodeUint16(data, o + 4),
        temperature: decodeInt16(data, o + 6),
        samples: [],
        magX: decodeInt16(data, o + 56),
        magY: decodeInt16(data, o + 58),
        magZ: decodeInt16(data, o + 60)
      };
      var iterationCount = (message.sampleCount > 2) ? 3 : message.sampleCount;
      for (var n = 0; n < iterationCount; n++) {
        message.samples.push({
          accel: decodeSensorData(data, o + 8 + 16 * n),
          gyro: decodeSensorData(data, o + 16 + 16 * n)
        });
      }
      if (nn % 100 == 0) {
        //console.log(message.samples[0].accel, message.samples[0].gyro);
      }
      nn++;

      // console.log('time since last', Date.now() - lastKeepAliveTime);
      if (Date.now() - lastKeepAliveTime > 5 * 1000) {
        console.log('keep alive ping');
        setSensorKeepAlive(device, deviceDesc, 10 * 1000, function(error) {
        });
        lastKeepAliveTime = Date.now();
      }

      return true;
    });
  });
};

function pumpInput(device, endpointAddress, reportSize, callback) {
  chrome.usb.interruptTransfer(device, {
    direction: 'in',
    endpoint: endpointAddress,
    length: reportSize
  }, function(info) {
    if (info.resultCode) {
      console.log('interrupt fail');
      callback(null);
      return;
    }
    var data = new Uint8Array(info.data);
    if (callback(data)) {
      pumpInput(device, endpointAddress, reportSize, callback);
    }
  });
};

