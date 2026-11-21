# File: modules/telemetry/GetDisplayMetrics.ps1

if (-not ("CoreWatch.DisplayProbe" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace CoreWatch {
    public class MonitorVideoInfo {
        public string DeviceName { get; set; }
        public string FriendlyName { get; set; }
        public bool IsPrimary { get; set; }
        public string Resolution { get; set; }
        public string RefreshRate { get; set; }
        public string Orientation { get; set; }
        public string Scale { get; set; }
        public string ConnectionType { get; set; }
        public string HdrStatus { get; set; }
        public string ColorProfile { get; set; }
    }

    public static class DisplayProbe {
        private const int ENUM_CURRENT_SETTINGS = -1;
        private const int DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x1;
        private const int DISPLAY_DEVICE_PRIMARY_DEVICE = 0x4;
        private const uint QDC_ONLY_ACTIVE_PATHS = 0x00000002;
        private const int MDT_EFFECTIVE_DPI = 0;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DISPLAY_DEVICE {
            public int cb;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string DeviceName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string DeviceString;
            public int StateFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string DeviceID;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string DeviceKey;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DEVMODE {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string dmDeviceName;
            public short dmSpecVersion;
            public short dmDriverVersion;
            public short dmSize;
            public short dmDriverExtra;
            public int dmFields;
            public int dmPositionX;
            public int dmPositionY;
            public int dmDisplayOrientation;
            public int dmDisplayFixedOutput;
            public short dmColor;
            public short dmDuplex;
            public short dmYResolution;
            public short dmTTOption;
            public short dmCollate;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string dmFormName;
            public short dmLogPixels;
            public int dmBitsPerPel;
            public int dmPelsWidth;
            public int dmPelsHeight;
            public int dmDisplayFlags;
            public int dmDisplayFrequency;
            public int dmICMMethod;
            public int dmICMIntent;
            public int dmMediaType;
            public int dmDitherType;
            public int dmReserved1;
            public int dmReserved2;
            public int dmPanningWidth;
            public int dmPanningHeight;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LUID {
            public uint LowPart;
            public int HighPart;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_RATIONAL {
            public uint Numerator;
            public uint Denominator;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_PATH_SOURCE_INFO {
            public LUID adapterId;
            public uint id;
            public uint modeInfoIdx;
            public uint statusFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_PATH_TARGET_INFO {
            public LUID adapterId;
            public uint id;
            public uint modeInfoIdx;
            public uint outputTechnology;
            public uint rotation;
            public uint scaling;
            public DISPLAYCONFIG_RATIONAL refreshRate;
            public uint scanLineOrdering;
            [MarshalAs(UnmanagedType.Bool)]
            public bool targetAvailable;
            public uint statusFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_PATH_INFO {
            public DISPLAYCONFIG_PATH_SOURCE_INFO sourceInfo;
            public DISPLAYCONFIG_PATH_TARGET_INFO targetInfo;
            public uint flags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_MODE_INFO {
            public uint infoType;
            public uint id;
            public LUID adapterId;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 48)]
            public byte[] modeData;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_DEVICE_INFO_HEADER {
            public int type;
            public int size;
            public LUID adapterId;
            public uint id;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DISPLAYCONFIG_SOURCE_DEVICE_NAME {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string viewGdiDeviceName;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DISPLAYCONFIG_TARGET_DEVICE_NAME {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            public uint flags;
            public uint outputTechnology;
            public ushort edidManufactureId;
            public ushort edidProductCodeId;
            public uint connectorInstance;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string monitorFriendlyDeviceName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string monitorDevicePath;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            public uint value;
            public int colorEncoding;
            public int bitsPerColorChannel;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_2 {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            public uint value;
            public int colorEncoding;
            public int bitsPerColorChannel;
            public int activeColorMode;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT {
            public int X;
            public int Y;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool EnumDisplaySettingsEx(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode, uint dwFlags);

        [DllImport("user32.dll")]
        private static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPathArrayElements, out uint numModeInfoArrayElements);

        [DllImport("user32.dll")]
        private static extern int QueryDisplayConfig(uint flags, ref uint numPathArrayElements, [Out] DISPLAYCONFIG_PATH_INFO[] pathArray, ref uint numModeInfoArrayElements, [Out] DISPLAYCONFIG_MODE_INFO[] modeInfoArray, IntPtr currentTopologyId);

        [DllImport("user32.dll")]
        private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_SOURCE_DEVICE_NAME requestPacket);

        [DllImport("user32.dll")]
        private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_TARGET_DEVICE_NAME requestPacket);

        [DllImport("user32.dll")]
        private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO requestPacket);

        [DllImport("user32.dll")]
        private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_2 requestPacket);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

        [DllImport("shcore.dll")]
        private static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateDCW(string lpszDriver, string lpszDevice, string lpszOutput, IntPtr lpInitData);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
        private static extern bool GetICMProfileW(IntPtr hdc, ref uint lpcbName, StringBuilder lpszFilename);

        private static string MapOutputTechnology(uint tech) {
            if ((tech & 0x80000000) != 0) return "Internal";
            switch (tech) {
                case 0:  return "VGA";
                case 1:  return "S-Video";
                case 2:  return "Composite";
                case 3:  return "Component";
                case 4:  return "DVI";
                case 5:  return "HDMI";
                case 6:  return "LVDS (Internal)";
                case 8:  return "D-Jpn";
                case 9:  return "SDI";
                case 10: return "DisplayPort";
                case 11: return "eDP (Internal)";
                case 12: return "UDI";
                case 13: return "UDI (Internal)";
                case 14: return "SDTV";
                case 15: return "Miracast / Virtual";
                case 16: return "Indirect / USB";
                default: return "Unknown";
            }
        }

        private static string MapOrientation(int orient) {
            switch (orient) {
                case 0: return "Landscape";
                case 1: return "Portrait";
                case 2: return "Landscape (Flipped)";
                case 3: return "Portrait (Flipped)";
                default: return "Landscape";
            }
        }

        private static string GetColorProfileForDevice(string deviceName) {
            IntPtr hdc = IntPtr.Zero;
            try {
                hdc = CreateDCW("DISPLAY", deviceName, null, IntPtr.Zero);
                if (hdc != IntPtr.Zero) {
                    uint size = 260;
                    StringBuilder sb = new StringBuilder((int)size);
                    if (GetICMProfileW(hdc, ref size, sb)) {
                        string fullPath = sb.ToString();
                        if (!string.IsNullOrWhiteSpace(fullPath)) {
                            string fileName = Path.GetFileNameWithoutExtension(fullPath);
                            if (string.Equals(fileName, "sRGB Color Space Profile", StringComparison.OrdinalIgnoreCase)) {
                                return "sRGB (Default)";
                            }
                            return fileName;
                        }
                    }
                }
            } catch { }
            finally {
                if (hdc != IntPtr.Zero) DeleteDC(hdc);
            }
            return "sRGB (Default)";
        }

        public static List<MonitorVideoInfo> GetMonitors() {
            var ccdMap = new Dictionary<string, Tuple<string, string, string>>(StringComparer.OrdinalIgnoreCase);

            try {
                uint pathCount, modeCount;
                if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out pathCount, out modeCount) == 0 && pathCount > 0) {
                    var paths = new DISPLAYCONFIG_PATH_INFO[pathCount];
                    var modes = new DISPLAYCONFIG_MODE_INFO[modeCount];
                    if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero) == 0) {
                        for (int i = 0; i < pathCount; i++) {
                            var srcName = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
                            srcName.header.type = 1; // DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME
                            srcName.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME));
                            srcName.header.adapterId = paths[i].sourceInfo.adapterId;
                            srcName.header.id = paths[i].sourceInfo.id;

                            if (DisplayConfigGetDeviceInfo(ref srcName) != 0 || string.IsNullOrEmpty(srcName.viewGdiDeviceName)) {
                                continue;
                            }

                            string friendly = "";
                            string conn = MapOutputTechnology(paths[i].targetInfo.outputTechnology);
                            var tgtName = new DISPLAYCONFIG_TARGET_DEVICE_NAME();
                            tgtName.header.type = 2; // DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME
                            tgtName.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_TARGET_DEVICE_NAME));
                            tgtName.header.adapterId = paths[i].targetInfo.adapterId;
                            tgtName.header.id = paths[i].targetInfo.id;
                            if (DisplayConfigGetDeviceInfo(ref tgtName) == 0) {
                                if (!string.IsNullOrWhiteSpace(tgtName.monitorFriendlyDeviceName)) {
                                    friendly = tgtName.monitorFriendlyDeviceName.Trim();
                                }
                                if (conn == "Unknown") {
                                    conn = MapOutputTechnology(tgtName.outputTechnology);
                                }
                            }

                            string hdr = "Not Supported";
                            var advColor2 = new DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_2();
                            advColor2.header.type = 15; // DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO_2 (Win11 24H2+)
                            advColor2.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_2));
                            advColor2.header.adapterId = paths[i].targetInfo.adapterId;
                            advColor2.header.id = paths[i].targetInfo.id;
                            if (DisplayConfigGetDeviceInfo(ref advColor2) == 0) {
                                bool hdrSupported = (advColor2.value & 0x10) != 0; // highDynamicRangeSupported
                                bool hdrActive = (advColor2.activeColorMode == 2); // DISPLAYCONFIG_ADVANCED_COLOR_MODE_HDR
                                if (hdrActive) hdr = "On";
                                else if (hdrSupported) hdr = "Off (Supported)";
                                else hdr = "Not Supported";
                            } else {
                                var advColor = new DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO();
                                advColor.header.type = 9; // Fallback for older Windows 10/11
                                advColor.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO));
                                advColor.header.adapterId = paths[i].targetInfo.adapterId;
                                advColor.header.id = paths[i].targetInfo.id;
                                if (DisplayConfigGetDeviceInfo(ref advColor) == 0) {
                                    bool supported = (advColor.value & 0x1) != 0;
                                    bool enabled = (advColor.value & 0x2) != 0;
                                    bool wcgOnly = (advColor.value & 0x4) != 0 && !enabled;
                                    if (enabled) hdr = "On";
                                    else if (supported && !wcgOnly) hdr = "Off (Supported)";
                                    else hdr = "Not Supported";
                                }
                            }

                            if (!ccdMap.ContainsKey(srcName.viewGdiDeviceName)) {
                                ccdMap[srcName.viewGdiDeviceName] = Tuple.Create(friendly, conn, hdr);
                            }
                        }
                    }
                }
            } catch { }

            var result = new List<MonitorVideoInfo>();
            uint devNum = 0;
            while (true) {
                var dd = new DISPLAY_DEVICE();
                dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
                if (!EnumDisplayDevices(null, devNum, ref dd, 0)) break;
                devNum++;

                if ((dd.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) == 0) continue;

                var dm = new DEVMODE();
                dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                if (!EnumDisplaySettingsEx(dd.DeviceName, ENUM_CURRENT_SETTINGS, ref dm, 0)) continue;

                bool isPrimary = (dd.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE) != 0;
                string scaleStr = "100%";
                try {
                    var pt = new POINT { X = dm.dmPositionX + 1, Y = dm.dmPositionY + 1 };
                    IntPtr hMon = MonitorFromPoint(pt, 2);
                    if (hMon != IntPtr.Zero) {
                        uint dpiX, dpiY;
                        if (GetDpiForMonitor(hMon, MDT_EFFECTIVE_DPI, out dpiX, out dpiY) == 0 && dpiX > 0) {
                            scaleStr = ((int)Math.Round(dpiX * 100.0 / 96.0)).ToString() + "%";
                        }
                    }
                } catch { }

                string friendly = "";
                string conn = "Unknown";
                string hdr = "Unknown";
                if (ccdMap.ContainsKey(dd.DeviceName)) {
                    var tuple = ccdMap[dd.DeviceName];
                    friendly = tuple.Item1;
                    conn = tuple.Item2;
                    hdr = tuple.Item3;
                }

                if (string.IsNullOrWhiteSpace(friendly)) {
                    var monDev = new DISPLAY_DEVICE();
                    monDev.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
                    if (EnumDisplayDevices(dd.DeviceName, 0, ref monDev, 0) && !string.IsNullOrWhiteSpace(monDev.DeviceString)) {
                        friendly = monDev.DeviceString.Trim();
                    } else {
                        friendly = dd.DeviceName.Replace(@"\\.\", "");
                    }
                }

                result.Add(new MonitorVideoInfo {
                    DeviceName = dd.DeviceName,
                    FriendlyName = friendly,
                    IsPrimary = isPrimary,
                    Resolution = string.Format("{0} x {1}", dm.dmPelsWidth, dm.dmPelsHeight),
                    RefreshRate = string.Format("{0} Hz", dm.dmDisplayFrequency),
                    Orientation = MapOrientation(dm.dmDisplayOrientation),
                    Scale = scaleStr,
                    ConnectionType = conn,
                    HdrStatus = hdr,
                    ColorProfile = GetColorProfileForDevice(dd.DeviceName)
                });
            }

            return result;
        }
    }
}
"@ -ErrorAction SilentlyContinue
}

function Get-NightLightStatus {
    try {
        $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default`$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate"
        if (Test-Path -LiteralPath $regPath -ErrorAction SilentlyContinue) {
            $data = (Get-ItemProperty -LiteralPath $regPath -Name "Data" -ErrorAction SilentlyContinue).Data
            if ($data -and $data.Length -gt 24) {
                if ($data[18] -eq 0x15) { return "On" }
                return "Off"
            }
        }
    } catch {}
    return "Off"
}

function Get-DisplayMetrics {
    $nightLight = Get-NightLightStatus
    $monitors = @()
    try {
        $rawList = [CoreWatch.DisplayProbe]::GetMonitors()
        $idx = 1
        foreach ($m in $rawList) {
            $label = if ($m.IsPrimary) { "Display $idx - $($m.FriendlyName) (Primary)" } else { "Display $idx - $($m.FriendlyName)" }
            $monitors += [PSCustomObject]@{
                Id             = [string]$m.DeviceName
                Label          = [string]$label
                FriendlyName   = [string]$m.FriendlyName
                IsPrimary      = [bool]$m.IsPrimary
                Resolution     = [string]$m.Resolution
                RefreshRate    = [string]$m.RefreshRate
                ColorProfile   = [string]$m.ColorProfile
                ConnectionType = [string]$m.ConnectionType
                HdrStatus      = [string]$m.HdrStatus
                NightLight     = [string]$nightLight
                Scale          = [string]$m.Scale
                Orientation    = [string]$m.Orientation
            }
            $idx++
        }
    } catch {}

    return @($monitors)
}
