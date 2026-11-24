using System;
using System.Globalization;
using LibreHardwareMonitor.Hardware;

namespace CoreWatchSensorHelper {
    internal static class Program {
        private static int Main(string[] args) {
            bool onceMode = args != null && args.Length > 0 && string.Equals(args[0], "--once", StringComparison.OrdinalIgnoreCase);

            Computer computer = null;
            try {
                computer = new Computer {
                    IsCpuEnabled = true,
                    IsGpuEnabled = true,
                    IsMemoryEnabled = false,
                    IsMotherboardEnabled = false,
                    IsControllerEnabled = false,
                    IsNetworkEnabled = false,
                    IsStorageEnabled = false
                };
                computer.Open();

                if (onceMode) {
                    Console.WriteLine(ReadSnapshotJson(computer));
                    return 0;
                }

                // Persistent stdio loop: parent writes a newline -> we update & return one JSON line (<3ms)
                Console.WriteLine(ReadSnapshotJson(computer));
                Console.Out.Flush();

                string line;
                while ((line = Console.ReadLine()) != null) {
                    if (string.Equals(line.Trim(), "EXIT", StringComparison.OrdinalIgnoreCase)) break;
                    Console.WriteLine(ReadSnapshotJson(computer));
                    Console.Out.Flush();
                }
                return 0;
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
                return 1;
            } finally {
                try { if (computer != null) computer.Close(); } catch { }
            }
        }

        private static string ReadSnapshotJson(Computer computer) {
            double? bestCpuTemp = null;
            int bestCpuPriority = 999;
            string bestCpuSensor = "";
            double? cpuPkgPower = null;

            double? gpuLoad = null;
            double? gpuTemp = null;
            double? gpuPower = null;
            double? gpuVramUsed = null;
            double? gpuVramTotal = null;
            int bestGpuRank = -1;

            foreach (IHardware hw in computer.Hardware) {
                if (hw.HardwareType == HardwareType.Cpu) {
                    hw.Update();
                    foreach (ISensor s in hw.Sensors) {
                        if (!s.Value.HasValue) continue;
                        double v = s.Value.Value;

                        if (s.SensorType == SensorType.Temperature && v >= 15.0 && v <= 120.0) {
                            string n = s.Name ?? "";
                            int pri = 50;
                            if (n.IndexOf("Tctl/Tdie", StringComparison.OrdinalIgnoreCase) >= 0) pri = 1;
                            else if (n.IndexOf("CPU Package", StringComparison.OrdinalIgnoreCase) >= 0) pri = 2;
                            else if (n.IndexOf("Core (Tctl", StringComparison.OrdinalIgnoreCase) >= 0) pri = 3;
                            else if (n.IndexOf("Tdie", StringComparison.OrdinalIgnoreCase) >= 0) pri = 4;
                            else if (n.IndexOf("Core Max", StringComparison.OrdinalIgnoreCase) >= 0) pri = 5;
                            else if (n.IndexOf("Core Average", StringComparison.OrdinalIgnoreCase) >= 0) pri = 6;
                            else if (n.IndexOf("Package", StringComparison.OrdinalIgnoreCase) >= 0) pri = 7;

                            if (pri < bestCpuPriority) {
                                bestCpuPriority = pri;
                                bestCpuTemp = v;
                                bestCpuSensor = n;
                            }
                        } else if (s.SensorType == SensorType.Power && v >= 0.0 && v <= 600.0) {
                            string n = s.Name ?? "";
                            if (n.IndexOf("Package", StringComparison.OrdinalIgnoreCase) >= 0 && !cpuPkgPower.HasValue) {
                                cpuPkgPower = v;
                            }
                        }
                    }
                } else if (hw.HardwareType == HardwareType.GpuNvidia ||
                           hw.HardwareType == HardwareType.GpuAmd ||
                           hw.HardwareType == HardwareType.GpuIntel) {
                    // Prefer discrete NVIDIA/AMD GPU over integrated Intel graphics
                    int rank = (hw.HardwareType == HardwareType.GpuNvidia) ? 3 :
                               (hw.HardwareType == HardwareType.GpuAmd ? 2 : 1);
                    if (rank < bestGpuRank) continue;

                    hw.Update();
                    double? tmpLoad = null, tmpTemp = null, tmpPower = null, tmpVramUsed = null, tmpVramTotal = null;
                    foreach (ISensor s in hw.Sensors) {
                        if (!s.Value.HasValue) continue;
                        double v = s.Value.Value;
                        string n = s.Name ?? "";

                        if (s.SensorType == SensorType.Load && v >= 0.0 && v <= 100.0) {
                            if (n.Equals("GPU Core", StringComparison.OrdinalIgnoreCase) || !tmpLoad.HasValue) {
                                tmpLoad = v;
                            }
                        } else if (s.SensorType == SensorType.Temperature && v >= 10.0 && v <= 125.0) {
                            if (n.Equals("GPU Core", StringComparison.OrdinalIgnoreCase) || !tmpTemp.HasValue) {
                                tmpTemp = v;
                            }
                        } else if (s.SensorType == SensorType.Power && v >= 0.0 && v <= 1000.0) {
                            if (n.IndexOf("Package", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                n.IndexOf("Total", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                !tmpPower.HasValue) {
                                tmpPower = v;
                            }
                        } else if (s.SensorType == SensorType.SmallData && v >= 0.0) {
                            if (n.Equals("GPU Memory Used", StringComparison.OrdinalIgnoreCase)) tmpVramUsed = v;
                            else if (n.Equals("GPU Memory Total", StringComparison.OrdinalIgnoreCase)) tmpVramTotal = v;
                        }
                    }

                    if (tmpTemp.HasValue || tmpLoad.HasValue || tmpPower.HasValue) {
                        bestGpuRank = rank;
                        gpuLoad = tmpLoad;
                        gpuTemp = tmpTemp;
                        gpuPower = tmpPower;
                        gpuVramUsed = tmpVramUsed;
                        gpuVramTotal = tmpVramTotal;
                    }
                }
            }

            return string.Format(
                CultureInfo.InvariantCulture,
                "{{\"cpuTemp\":{0},\"cpuPower\":{1},\"sensor\":\"{2}\",\"gpuLoad\":{3},\"gpuTemp\":{4},\"gpuPower\":{5},\"gpuVramUsedMB\":{6},\"gpuVramTotalMB\":{7}}}",
                FmtInt(bestCpuTemp),
                FmtFloat(cpuPkgPower),
                EscapeJson(bestCpuSensor),
                FmtInt(gpuLoad),
                FmtInt(gpuTemp),
                FmtFloat(gpuPower),
                FmtFloat(gpuVramUsed),
                FmtFloat(gpuVramTotal)
            );
        }

        private static string FmtInt(double? val) {
            return val.HasValue ? Math.Round(val.Value).ToString(CultureInfo.InvariantCulture) : "null";
        }

        private static string FmtFloat(double? val) {
            return val.HasValue ? Math.Round(val.Value, 1).ToString(CultureInfo.InvariantCulture) : "null";
        }

        private static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
        }
    }
}
