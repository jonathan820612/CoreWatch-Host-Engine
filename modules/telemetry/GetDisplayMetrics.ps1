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
        public int RefreshRateHz { get; set; }
        public int[] AvailableRefreshRates { get; set; }
        public string Orientation { get; set; }
        public int OrientationCode { get; set; }
        public string Scale { get; set; }
        public int ScalePct { get; set; }
        public int[] AvailableScales { get; set; }
        public int BoundsX { get; set; }
        public int BoundsY { get; set; }
        public int BoundsWidth { get; set; }
        public int BoundsHeight { get; set; }
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
        private const uint CDS_UPDATEREGISTRY = 0x00000001;
        private const uint CDS_TEST = 0x00000002;
        private const int DISP_CHANGE_SUCCESSFUL = 0;

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

        // [DYNAMIC CONTROL] Structs for DisplayConfigSetDeviceInfo HDR toggle (Win10/11 + Win11 24H2+)
        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            public uint value;
        }

        // [DYNAMIC CONTROL] Undocumented native Windows CCD per-monitor DPI Scale structs (used by Windows Settings)
        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_SOURCE_DPI_SCALE_GET {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            public int minScaleRel;
            public int curScaleRel;
            public int maxScaleRel;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_SOURCE_DPI_SCALE_SET {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            public int scaleRel;
        }

        private static readonly int[] StandardDpiScales = new int[] { 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500 };

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT {
            public int X;
            public int Y;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool EnumDisplaySettingsEx(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int ChangeDisplaySettingsEx(string lpszDeviceName, ref DEVMODE lpDevMode, IntPtr hwnd, uint dwflags, IntPtr lParam);

        // [DYNAMIC CONTROL] Safely change monitor refresh rate using ONLY GPU-driver-verified modes + CDS_TEST
        public static string SetMonitorRefreshRate(string targetDeviceName, int targetHz) {
            try {
                if (string.IsNullOrWhiteSpace(targetDeviceName)) {
                    return "Target display device name is required.";
                }
                if (targetHz < 24 || targetHz > 1000) {
                    return "Requested refresh rate is outside safe Windows display bounds.";
                }

                var current = new DEVMODE();
                current.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                if (!EnumDisplaySettingsEx(targetDeviceName, ENUM_CURRENT_SETTINGS, ref current, 0)) {
                    return "Unable to query current settings for " + targetDeviceName;
                }

                if (current.dmDisplayFrequency == targetHz) {
                    return "OK";
                }

                // Match strictly against driver-enumerated safe modes at the exact current resolution, bit depth & orientation
                DEVMODE matched = new DEVMODE();
                bool foundSafeMode = false;
                int modeNum = 0;
                while (true) {
                    var cand = new DEVMODE();
                    cand.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                    if (!EnumDisplaySettingsEx(targetDeviceName, modeNum++, ref cand, 0)) break;

                    if (cand.dmPelsWidth == current.dmPelsWidth &&
                        cand.dmPelsHeight == current.dmPelsHeight &&
                        cand.dmBitsPerPel == current.dmBitsPerPel &&
                        cand.dmDisplayOrientation == current.dmDisplayOrientation &&
                        cand.dmDisplayFrequency == targetHz) {
                        matched = cand;
                        foundSafeMode = true;
                        break;
                    }
                }

                if (!foundSafeMode) {
                    return string.Format("{0} Hz is not in the driver-verified safe modes for {1}x{2}.", targetHz, current.dmPelsWidth, current.dmPelsHeight);
                }

                // Pre-validate with CDS_TEST before committing
                int testRes = ChangeDisplaySettingsEx(targetDeviceName, ref matched, IntPtr.Zero, CDS_TEST, IntPtr.Zero);
                if (testRes != DISP_CHANGE_SUCCESSFUL) {
                    return string.Format("Windows display driver rejected {0} Hz during safety test (code {1}).", targetHz, testRes);
                }

                int applyRes = ChangeDisplaySettingsEx(targetDeviceName, ref matched, IntPtr.Zero, CDS_UPDATEREGISTRY, IntPtr.Zero);
                if (applyRes != DISP_CHANGE_SUCCESSFUL) {
                    return string.Format("Windows failed to apply {0} Hz (code {1}).", targetHz, applyRes);
                }

                return "OK";
            } catch (Exception ex) {
                return ex.Message;
            }
        }

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
        private static extern int DisplayConfigSetDeviceInfo(ref DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE setPacket);

        [DllImport("user32.dll")]
        private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_SOURCE_DPI_SCALE_GET requestPacket);

        [DllImport("user32.dll")]
        private static extern int DisplayConfigSetDeviceInfo(ref DISPLAYCONFIG_SOURCE_DPI_SCALE_SET setPacket);

        // [DYNAMIC CONTROL] Safely change monitor orientation (0=Landscape, 1=Portrait, 2=Landscape Flipped, 3=Portrait Flipped)
        public static string SetMonitorOrientation(string targetDeviceName, int targetOrientation) {
            try {
                if (string.IsNullOrWhiteSpace(targetDeviceName)) {
                    return "Target display device name is required.";
                }
                if (targetOrientation < 0 || targetOrientation > 3) {
                    return "Invalid display orientation code (expected 0..3).";
                }

                var dm = new DEVMODE();
                dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                if (!EnumDisplaySettingsEx(targetDeviceName, ENUM_CURRENT_SETTINGS, ref dm, 0)) {
                    return "Unable to query current display mode for " + targetDeviceName;
                }

                if (dm.dmDisplayOrientation == targetOrientation) {
                    return "OK";
                }

                bool wasPortrait  = (dm.dmDisplayOrientation % 2) == 1;
                bool wantPortrait = (targetOrientation % 2) == 1;
                if (wasPortrait != wantPortrait) {
                    int tmp = dm.dmPelsWidth;
                    dm.dmPelsWidth = dm.dmPelsHeight;
                    dm.dmPelsHeight = tmp;
                }

                dm.dmDisplayOrientation = targetOrientation;
                dm.dmFields |= 0x00000080 | 0x00080000 | 0x00100000; // DM_DISPLAYORIENTATION | DM_PELSWIDTH | DM_PELSHEIGHT

                int testRes = ChangeDisplaySettingsEx(targetDeviceName, ref dm, IntPtr.Zero, CDS_TEST, IntPtr.Zero);
                if (testRes != DISP_CHANGE_SUCCESSFUL) {
                    return string.Format("Windows display driver rejected orientation change during safety test (code {0}).", testRes);
                }

                int applyRes = ChangeDisplaySettingsEx(targetDeviceName, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY, IntPtr.Zero);
                if (applyRes != DISP_CHANGE_SUCCESSFUL) {
                    return string.Format("Windows failed to apply orientation change (code {0}).", applyRes);
                }

                return "OK";
            } catch (Exception ex) {
                return ex.Message;
            }
        }

        // [DYNAMIC CONTROL] Change per-monitor Windows DPI Scale instantaneously via native CCD API
        public static string SetMonitorScale(string targetDeviceName, int targetScalePct) {
            try {
                if (string.IsNullOrWhiteSpace(targetDeviceName)) {
                    return "Target display device name is required.";
                }

                int targetIdx = Array.IndexOf(StandardDpiScales, targetScalePct);
                if (targetIdx < 0) {
                    return "Unsupported scale percentage: " + targetScalePct + "%";
                }

                uint pathCount, modeCount;
                if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out pathCount, out modeCount) != 0 || pathCount == 0) {
                    return "Unable to query active Windows display configuration.";
                }
                var paths = new DISPLAYCONFIG_PATH_INFO[pathCount];
                var modes = new DISPLAYCONFIG_MODE_INFO[modeCount];
                if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero) != 0) {
                    return "QueryDisplayConfig failed.";
                }

                for (int i = 0; i < pathCount; i++) {
                    var srcName = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
                    srcName.header.type = 1;
                    srcName.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME));
                    srcName.header.adapterId = paths[i].sourceInfo.adapterId;
                    srcName.header.id = paths[i].sourceInfo.id;

                    if (DisplayConfigGetDeviceInfo(ref srcName) != 0 ||
                        !string.Equals(srcName.viewGdiDeviceName, targetDeviceName, StringComparison.OrdinalIgnoreCase)) {
                        continue;
                    }

                    var dpiGet = new DISPLAYCONFIG_SOURCE_DPI_SCALE_GET();
                    dpiGet.header.type = -3; // DISPLAYCONFIG_DEVICE_INFO_GET_DPI_SCALE
                    dpiGet.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DPI_SCALE_GET));
                    dpiGet.header.adapterId = paths[i].sourceInfo.adapterId;
                    dpiGet.header.id = paths[i].sourceInfo.id;

                    if (DisplayConfigGetDeviceInfo(ref dpiGet) != 0) {
                        return "Windows did not expose CCD DPI scale range for " + targetDeviceName;
                    }

                    int recIdx = Math.Abs(dpiGet.minScaleRel);
                    int minIdx = 0;
                    int maxIdx = Math.Min(StandardDpiScales.Length - 1, recIdx + dpiGet.maxScaleRel);
                    if (targetIdx < minIdx || targetIdx > maxIdx) {
                        return string.Format("Scale {0}% is outside the supported range ({1}%..{2}%) for this display.", targetScalePct, StandardDpiScales[minIdx], StandardDpiScales[maxIdx]);
                    }

                    int relVal = targetIdx - recIdx;
                    var dpiSet = new DISPLAYCONFIG_SOURCE_DPI_SCALE_SET();
                    dpiSet.header.type = -4; // DISPLAYCONFIG_DEVICE_INFO_SET_DPI_SCALE
                    dpiSet.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DPI_SCALE_SET));
                    dpiSet.header.adapterId = paths[i].sourceInfo.adapterId;
                    dpiSet.header.id = paths[i].sourceInfo.id;
                    dpiSet.scaleRel = relVal;

                    int setRes = DisplayConfigSetDeviceInfo(ref dpiSet);
                    if (setRes != 0) {
                        return string.Format("Windows rejected scale change to {0}% (code {1}).", targetScalePct, setRes);
                    }
                    return "OK";
                }

                return "Could not match active CCD source path for " + targetDeviceName;
            } catch (Exception ex) {
                return ex.Message;
            }
        }

        // [DYNAMIC CONTROL] Toggle Windows HDR state on a specific monitor via CCD API
        public static bool SetHdrState(string targetDeviceName, bool enable) {
            try {
                uint pathCount, modeCount;
                if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out pathCount, out modeCount) != 0 || pathCount == 0) {
                    return false;
                }
                var paths = new DISPLAYCONFIG_PATH_INFO[pathCount];
                var modes = new DISPLAYCONFIG_MODE_INFO[modeCount];
                if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero) != 0) {
                    return false;
                }

                for (int i = 0; i < pathCount; i++) {
                    var srcName = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
                    srcName.header.type = 1;
                    srcName.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME));
                    srcName.header.adapterId = paths[i].sourceInfo.adapterId;
                    srcName.header.id = paths[i].sourceInfo.id;

                    if (DisplayConfigGetDeviceInfo(ref srcName) != 0 || string.IsNullOrEmpty(srcName.viewGdiDeviceName)) {
                        continue;
                    }
                    if (!string.IsNullOrEmpty(targetDeviceName) &&
                        !string.Equals(srcName.viewGdiDeviceName, targetDeviceName, StringComparison.OrdinalIgnoreCase)) {
                        continue;
                    }

                    // Try Win11 24H2+ DISPLAYCONFIG_DEVICE_INFO_SET_HDR_STATE (type 16) first, then legacy type 10
                    foreach (int setType in new int[] { 16, 10 }) {
                        var pkt = new DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE();
                        pkt.header.type = setType;
                        pkt.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE));
                        pkt.header.adapterId = paths[i].targetInfo.adapterId;
                        pkt.header.id = paths[i].targetInfo.id;
                        pkt.value = enable ? 1u : 0u;
                        if (DisplayConfigSetDeviceInfo(ref pkt) == 0) {
                            return true;
                        }
                    }
                }
            } catch { }
            return false;
        }

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
            var scaleRangeMap = new Dictionary<string, Tuple<int, int[]>>(StringComparer.OrdinalIgnoreCase);

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

                            if (!scaleRangeMap.ContainsKey(srcName.viewGdiDeviceName)) {
                                var dpiGet = new DISPLAYCONFIG_SOURCE_DPI_SCALE_GET();
                                dpiGet.header.type = -3;
                                dpiGet.header.size = Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DPI_SCALE_GET));
                                dpiGet.header.adapterId = paths[i].sourceInfo.adapterId;
                                dpiGet.header.id = paths[i].sourceInfo.id;
                                if (DisplayConfigGetDeviceInfo(ref dpiGet) == 0) {
                                    int recIdx = Math.Abs(dpiGet.minScaleRel);
                                    int curIdx = Math.Max(0, Math.Min(StandardDpiScales.Length - 1, recIdx + dpiGet.curScaleRel));
                                    int maxIdx = Math.Max(0, Math.Min(StandardDpiScales.Length - 1, recIdx + dpiGet.maxScaleRel));
                                    var avail = new List<int>();
                                    for (int sIdx = 0; sIdx <= maxIdx; sIdx++) avail.Add(StandardDpiScales[sIdx]);
                                    scaleRangeMap[srcName.viewGdiDeviceName] = Tuple.Create(StandardDpiScales[curIdx], avail.ToArray());
                                }
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
                int scalePct = 100;
                int[] availScales = new int[] { 100, 125, 150, 175 };
                if (scaleRangeMap.ContainsKey(dd.DeviceName)) {
                    scalePct = scaleRangeMap[dd.DeviceName].Item1;
                    availScales = scaleRangeMap[dd.DeviceName].Item2;
                } else {
                    try {
                        var pt = new POINT { X = dm.dmPositionX + 1, Y = dm.dmPositionY + 1 };
                        IntPtr hMon = MonitorFromPoint(pt, 2);
                        if (hMon != IntPtr.Zero) {
                            uint dpiX, dpiY;
                            if (GetDpiForMonitor(hMon, MDT_EFFECTIVE_DPI, out dpiX, out dpiY) == 0 && dpiX > 0) {
                                scalePct = (int)Math.Round(dpiX * 100.0 / 96.0);
                            }
                        }
                    } catch { }
                }
                string scaleStr = scalePct.ToString() + "%";

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

                // Enumerate safe driver-verified refresh rates for the current resolution & bit depth
                var safeRates = new SortedSet<int>();
                if (dm.dmDisplayFrequency > 0) safeRates.Add(dm.dmDisplayFrequency);
                try {
                    int modeNum = 0;
                    while (true) {
                        var cand = new DEVMODE();
                        cand.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                        if (!EnumDisplaySettingsEx(dd.DeviceName, modeNum++, ref cand, 0)) break;
                        if (cand.dmPelsWidth == dm.dmPelsWidth &&
                            cand.dmPelsHeight == dm.dmPelsHeight &&
                            cand.dmBitsPerPel == dm.dmBitsPerPel &&
                            cand.dmDisplayOrientation == dm.dmDisplayOrientation &&
                            cand.dmDisplayFrequency >= 24 && cand.dmDisplayFrequency <= 1000) {
                            safeRates.Add(cand.dmDisplayFrequency);
                        }
                    }
                } catch { }
                var rateArray = new int[safeRates.Count];
                safeRates.CopyTo(rateArray);

                result.Add(new MonitorVideoInfo {
                    DeviceName = dd.DeviceName,
                    FriendlyName = friendly,
                    IsPrimary = isPrimary,
                    Resolution = string.Format("{0} x {1}", dm.dmPelsWidth, dm.dmPelsHeight),
                    RefreshRate = string.Format("{0} Hz", dm.dmDisplayFrequency),
                    RefreshRateHz = dm.dmDisplayFrequency,
                    AvailableRefreshRates = rateArray,
                    Orientation = MapOrientation(dm.dmDisplayOrientation),
                    OrientationCode = dm.dmDisplayOrientation,
                    Scale = scaleStr,
                    ScalePct = scalePct,
                    AvailableScales = availScales,
                    BoundsX = dm.dmPositionX,
                    BoundsY = dm.dmPositionY,
                    BoundsWidth = dm.dmPelsWidth,
                    BoundsHeight = dm.dmPelsHeight,
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

function Get-NightLightRegistryPath {
    $candidates = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default`$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\Cache\DefaultAccount\`$`$windows.data.bluelightreduction.bluelightreductionstate\Current"
    )
    foreach ($p in $candidates) {
        if (Test-Path -LiteralPath $p -ErrorAction SilentlyContinue) { return $p }
    }
    return $candidates[0]
}

function Find-NightLightInnerHeaderIndex {
    param([byte[]]$Data)
    if (-not $Data -or $Data.Length -lt 18) { return -1 }
    # Locate the second "CB\x01\x00" (0x43 0x42 0x01 0x00) marker — start of inner Bond payload
    for ($i = 10; $i -le ($Data.Length - 4); $i++) {
        if ($Data[$i] -eq 0x43 -and $Data[$i + 1] -eq 0x42 -and $Data[$i + 2] -eq 0x01 -and $Data[$i + 3] -eq 0x00) {
            return $i
        }
    }
    return -1
}

function ConvertTo-Leb128Bytes {
    param([uint64]$Value)
    $list = [System.Collections.Generic.List[byte]]::new()
    $v = $Value
    do {
        $b = [byte]($v -band 0x7F)
        $v = $v -shr 7
        if ($v -ne 0) { $b = [byte]($b -bor 0x80) }
        $list.Add($b)
    } while ($v -ne 0)
    return ,$list.ToArray()
}

function New-CanonicalNightLightPayload {
    param([bool]$Enable)

    $unixNow = [uint64][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    [byte[]]$tsBytes = ConvertTo-Leb128Bytes -Value $unixNow

    # Build inner Bond payload: 43 42 01 00 [10 00 if On] D0 0A 02 C6 14 <ts> 00 00
    $inner = [System.Collections.Generic.List[byte]]::new()
    $inner.AddRange([byte[]]@(0x43, 0x42, 0x01, 0x00))
    if ($Enable) {
        $inner.AddRange([byte[]]@(0x10, 0x00))
    }
    $inner.AddRange([byte[]]@(0xD0, 0x0A, 0x02, 0xC6, 0x14))
    $inner.AddRange($tsBytes)
    $inner.AddRange([byte[]]@(0x00, 0x00))

    # Build outer CloudStore envelope
    $outer = [System.Collections.Generic.List[byte]]::new()
    $outer.AddRange([byte[]]@(0x43, 0x42, 0x01, 0x00, 0x0A, 0x02, 0x01, 0x00, 0x2A, 0x06))
    $outer.AddRange($tsBytes)
    $outer.AddRange([byte[]]@(0x2A, 0x2B, 0x0E))
    $outer.Add([byte]$inner.Count)
    $outer.AddRange($inner)
    $outer.AddRange([byte[]]@(0x00, 0x00, 0x00))

    return ,$outer.ToArray()
}

function Step-CloudStoreTimestampByte {
    param([byte[]]$Data)
    # If standard 5-byte LEB128 timestamp slot (10..14) precedes 2A 2B 0E marker, write fresh monotonic UTC timestamp
    if ($Data.Length -ge 18 -and $Data[15] -eq 0x2A -and $Data[16] -eq 0x2B -and $Data[17] -eq 0x0E) {
        $unixNow = [uint64][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        [byte[]]$ts = ConvertTo-Leb128Bytes -Value $unixNow
        if ($ts.Length -eq 5) {
            # Ensure strictly different from previous value if triggered twice in the same second
            if ($ts[0] -eq $Data[10] -and $ts[1] -eq $Data[11] -and $ts[2] -eq $Data[12] -and $ts[3] -eq $Data[13] -and $ts[4] -eq $Data[14]) {
                $ts = ConvertTo-Leb128Bytes -Value ($unixNow + 1)
            }
            if ($ts.Length -eq 5) {
                [Array]::Copy($ts, 0, $Data, 10, 5)
                return
            }
        }
    }
    # Fallback: increment varint byte at index 10 while preserving MSB continuation bit (0x80)
    if ($Data.Length -gt 10) {
        $orig = $Data[10]
        $cont = [byte]($orig -band 0x80)
        $low7 = [byte]($orig -band 0x7F)
        $nextLow7 = if ($low7 -lt 0x7E) { [byte]($low7 + 1) } else { [byte]0x01 }
        $Data[10] = [byte]($cont -bor $nextLow7)
    }
}

function Get-NightLightStatus {
    try {
        $regPath = Get-NightLightRegistryPath
        if (Test-Path -LiteralPath $regPath -ErrorAction SilentlyContinue) {
            $data = [byte[]]((Get-ItemProperty -LiteralPath $regPath -Name "Data" -ErrorAction SilentlyContinue).Data)
            if ($data -and $data.Length -ge 20) {
                $innerIdx = Find-NightLightInnerHeaderIndex -Data $data
                if ($innerIdx -gt 0) {
                    $flagIdx = $innerIdx + 4
                    if (($flagIdx + 1) -lt $data.Length -and $data[$flagIdx] -eq 0x10 -and $data[$flagIdx + 1] -eq 0x00) {
                        return "On"
                    }
                    return "Off"
                }
                # Fallback for legacy layouts without inner CB header
                if ($data.Length -gt 24 -and $data[18] -eq 0x15) { return "On" }
            }
        }
    } catch {}
    return "Off"
}

# =========================================================================
# [DYNAMIC CONTROL] TOGGLE WINDOWS NIGHT LIGHT (CloudStore Registry State)
# Supports compact (23-26B), standard (41/43B), scheduled (45+B), and stub blobs.
# =========================================================================
function Set-NightLightStatus {
    param([bool]$Enable)

    $regPath = Get-NightLightRegistryPath
    if (-not (Test-Path -LiteralPath $regPath -ErrorAction SilentlyContinue)) {
        $null = New-Item -Path $regPath -Force -ErrorAction Stop
    }

    $raw = $null
    try {
        $raw = (Get-ItemProperty -LiteralPath $regPath -Name "Data" -ErrorAction SilentlyContinue).Data
    } catch {}

    $data = if ($raw -and $raw.Length -gt 0) { [byte[]]$raw } else { $null }
    $innerIdx = if ($data) { Find-NightLightInnerHeaderIndex -Data $data } else { -1 }

    # If the blob is missing, uninitialized, or a short Windows 11 stub without an inner CB header,
    # synthesize a clean canonical CloudStore payload directly.
    if ($null -eq $data -or $innerIdx -lt 12 -or ($innerIdx + 4) -gt $data.Length) {
        $freshPayload = New-CanonicalNightLightPayload -Enable $Enable
        Set-ItemProperty -LiteralPath $regPath -Name "Data" -Value $freshPayload -Type Binary -ErrorAction Stop
        return $true
    }

    $lenIdx  = $innerIdx - 1
    $flagIdx = $innerIdx + 4
    $currentlyOn = (($flagIdx + 1) -lt $data.Length -and $data[$flagIdx] -eq 0x10 -and $data[$flagIdx + 1] -eq 0x00)

    if ($currentlyOn -eq $Enable) {
        return $true
    }

    if ($Enable) {
        # Transition Off -> On: insert 0x10, 0x00 immediately after inner CB header and add +2 to inner length byte
        $newData = New-Object byte[] ($data.Length + 2)
        [Array]::Copy($data, 0, $newData, 0, $flagIdx)
        $newData[$flagIdx]     = 0x10
        $newData[$flagIdx + 1] = 0x00
        if ($flagIdx -lt $data.Length) {
            [Array]::Copy($data, $flagIdx, $newData, $flagIdx + 2, $data.Length - $flagIdx)
        }
        $newData[$lenIdx] = [byte]([math]::Min(255, [int]$data[$lenIdx] + 2))
    } else {
        # Transition On -> Off: remove 0x10, 0x00 immediately after inner CB header and subtract 2 from inner length byte
        $newData = New-Object byte[] ($data.Length - 2)
        [Array]::Copy($data, 0, $newData, 0, $flagIdx)
        if (($flagIdx + 2) -lt $data.Length) {
            [Array]::Copy($data, $flagIdx + 2, $newData, $flagIdx, $data.Length - ($flagIdx + 2))
        }
        $newData[$lenIdx] = [byte]([math]::Max(0, [int]$data[$lenIdx] - 2))
    }

    Step-CloudStoreTimestampByte -Data $newData
    Set-ItemProperty -LiteralPath $regPath -Name "Data" -Value $newData -Type Binary -ErrorAction Stop
    return $true
}

# =========================================================================
# [DYNAMIC CONTROL] NIGHT LIGHT BLUE-LIGHT STRENGTH / KELVIN (1200K - 6500K)
# Reads & patches 0xCF 0x28 ZigZag-LEB128 Kelvin bytes in bluelightreduction.settings
# =========================================================================
function Get-NightLightSettingsRegistryPath {
    $candidates = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default`$windows.data.bluelightreduction.settings\windows.data.bluelightreduction.settings",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\Cache\DefaultAccount\`$`$windows.data.bluelightreduction.settings\Current"
    )
    foreach ($p in $candidates) {
        if (Test-Path -LiteralPath $p -ErrorAction SilentlyContinue) { return $p }
    }
    return $candidates[0]
}

function Convert-StrengthPctToKelvin {
    param([int]$StrengthPct)
    $clamped = [math]::Max(0, [math]::Min(100, $StrengthPct))
    return [int][math]::Round(6500.0 - ($clamped / 100.0) * (6500.0 - 1200.0))
}

function Convert-KelvinToStrengthPct {
    param([int]$Kelvin)
    $clamped = [math]::Max(1200, [math]::Min(6500, $Kelvin))
    return [int][math]::Round(((6500.0 - $clamped) / (6500.0 - 1200.0)) * 100.0)
}

function Encode-NightLightKelvinBytes {
    param([int]$Kelvin)
    $k = [math]::Max(1200, [math]::Min(6500, $Kelvin))
    [byte]$lo = [byte]((($k -band 0x3F) * 2) -bor 0x80)
    [byte]$hi = [byte](($k -shr 6) -band 0x7F)
    return ,[byte[]]@($lo, $hi)
}

function Decode-NightLightKelvinBytes {
    param([byte]$Lo, [byte]$Hi)
    return (([int]($Lo -band 0x7F) -shr 1) + ([int]$Hi -shl 6))
}

function Get-NightLightStrength {
    $kelvin = 4800 # Windows default (~32%)
    try {
        $regPath = Get-NightLightSettingsRegistryPath
        if (Test-Path -LiteralPath $regPath -ErrorAction SilentlyContinue) {
            $data = [byte[]]((Get-ItemProperty -LiteralPath $regPath -Name "Data" -ErrorAction SilentlyContinue).Data)
            if ($data -and $data.Length -ge 20) {
                for ($i = 10; $i -le ($data.Length - 4); $i++) {
                    if ($data[$i] -eq 0xCF -and $data[$i + 1] -eq 0x28) {
                        $decoded = Decode-NightLightKelvinBytes -Lo $data[$i + 2] -Hi $data[$i + 3]
                        if ($decoded -ge 1200 -and $decoded -le 6500) {
                            $kelvin = $decoded
                            break
                        }
                    }
                }
            }
        }
    } catch {}

    return @{
        Kelvin      = $kelvin
        StrengthPct = Convert-KelvinToStrengthPct -Kelvin $kelvin
    }
}

function Set-NightLightStrength {
    param([int]$StrengthPct)

    $clampedPct = [math]::Max(0, [math]::Min(100, $StrengthPct))
    $kelvin = Convert-StrengthPctToKelvin -StrengthPct $clampedPct
    [byte[]]$kBytes = Encode-NightLightKelvinBytes -Kelvin $kelvin

    $regPath = Get-NightLightSettingsRegistryPath
    if (-not (Test-Path -LiteralPath $regPath -ErrorAction SilentlyContinue)) {
        $null = New-Item -Path $regPath -Force -ErrorAction Stop
    }

    $raw = $null
    try {
        $raw = (Get-ItemProperty -LiteralPath $regPath -Name "Data" -ErrorAction SilentlyContinue).Data
    } catch {}

    $patched = $false
    if ($raw -and $raw.Length -ge 20) {
        $data = [byte[]]$raw
        for ($i = 10; $i -le ($data.Length - 4); $i++) {
            if ($data[$i] -eq 0xCF -and $data[$i + 1] -eq 0x28) {
                $data[$i + 2] = $kBytes[0]
                $data[$i + 3] = $kBytes[1]
                Step-CloudStoreTimestampByte -Data $data
                Set-ItemProperty -LiteralPath $regPath -Name "Data" -Value $data -Type Binary -ErrorAction Stop
                $patched = $true
                break
            }
        }
    }

    if (-not $patched) {
        # Build canonical CloudStore bluelightreduction.settings payload
        $unixNow = [uint64][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        [byte[]]$tsBytes = ConvertTo-Leb128Bytes -Value $unixNow

        $inner = [System.Collections.Generic.List[byte]]::new()
        $inner.AddRange([byte[]]@(0x43, 0x42, 0x01, 0x00, 0xCF, 0x28))
        $inner.AddRange($kBytes)
        $inner.AddRange([byte[]]@(0xCA, 0x32, 0x00, 0xCA, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00))

        $outer = [System.Collections.Generic.List[byte]]::new()
        $outer.AddRange([byte[]]@(0x43, 0x42, 0x01, 0x00, 0x0A, 0x02, 0x01, 0x00, 0x2A, 0x06))
        $outer.AddRange($tsBytes)
        $outer.AddRange([byte[]]@(0x2A, 0x2B, 0x0E))
        $outer.Add([byte]$inner.Count)
        $outer.AddRange($inner)
        $outer.AddRange([byte[]]@(0x00, 0x00, 0x00))

        Set-ItemProperty -LiteralPath $regPath -Name "Data" -Value $outer.ToArray() -Type Binary -ErrorAction Stop
    }

    # [SAFE AUTO RE-APPLY] Windows Display Enhancement Service reloads bluelightreduction.settings
    # on a state transition. Perform a quick native Off -> On pulse so the new warmth applies immediately.
    if ((Get-NightLightStatus) -eq "On") {
        try {
            $null = Set-NightLightStatus -Enable $false
            Start-Sleep -Milliseconds 130
            $null = Set-NightLightStatus -Enable $true
        } catch {}
    }

    return @{
        Kelvin      = $kelvin
        StrengthPct = $clampedPct
    }
}

function Get-DisplayMetrics {
    $nightLight = Get-NightLightStatus
    $nlStrength = Get-NightLightStrength
    $monitors = @()
    try {
        $rawList = [CoreWatch.DisplayProbe]::GetMonitors()
        $idx = 1
        foreach ($m in $rawList) {
            $label = if ($m.IsPrimary) { "Display $idx - $($m.FriendlyName) (Primary)" } else { "Display $idx - $($m.FriendlyName)" }
            $monitors += [PSCustomObject]@{
                Id                    = [string]$m.DeviceName
                Label                 = [string]$label
                FriendlyName          = [string]$m.FriendlyName
                IsPrimary             = [bool]$m.IsPrimary
                Resolution            = [string]$m.Resolution
                RefreshRate           = [string]$m.RefreshRate
                RefreshRateHz         = [int]$m.RefreshRateHz
                AvailableRefreshRates = @($m.AvailableRefreshRates)
                ColorProfile          = [string]$m.ColorProfile
                ConnectionType        = [string]$m.ConnectionType
                HdrStatus             = [string]$m.HdrStatus
                NightLight            = [string]$nightLight
                NightLightStrength    = [int]$nlStrength.StrengthPct
                NightLightKelvin      = [int]$nlStrength.Kelvin
                Scale                 = [string]$m.Scale
                ScalePct              = [int]$m.ScalePct
                AvailableScales       = @($m.AvailableScales)
                Orientation           = [string]$m.Orientation
                OrientationCode       = [int]$m.OrientationCode
                BoundsX               = [int]$m.BoundsX
                BoundsY               = [int]$m.BoundsY
                BoundsWidth           = [int]$m.BoundsWidth
                BoundsHeight          = [int]$m.BoundsHeight
                DisplayNumber         = [int]$idx
            }
            $idx++
        }
    } catch {}

    return @($monitors)
}
