using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using LibreHardwareMonitor.Hardware;

namespace CoreWatchSensorHelper {
    internal static class Program {
        private static int Main(string[] args) {
            bool onceMode = false;
            bool thermalMode = false;
            bool thermalOnce = false;
            if (args != null) {
                foreach (string a in args) {
                    if (string.Equals(a, "--once", StringComparison.OrdinalIgnoreCase)) onceMode = true;
                    else if (string.Equals(a, "--thermal", StringComparison.OrdinalIgnoreCase)) thermalMode = true;
                    else if (string.Equals(a, "--thermal-once", StringComparison.OrdinalIgnoreCase)) { thermalMode = true; thermalOnce = true; }
                }
            }

            if (thermalMode) {
                return RunThermalLoop(thermalOnce);
            }
            return RunDashboardLoop(onceMode);
        }

        // =========================================================================
        // FAST LIGHTWEIGHT DASHBOARD MODE (CPU + GPU only, <3ms/poll, low RAM)
        // =========================================================================
        private static int RunDashboardLoop(bool onceMode) {
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
                    Console.WriteLine(ReadDashboardJson(computer));
                    return 0;
                }

                Console.WriteLine(ReadDashboardJson(computer));
                Console.Out.Flush();

                string line;
                while ((line = Console.ReadLine()) != null) {
                    if (string.Equals(line.Trim(), "EXIT", StringComparison.OrdinalIgnoreCase)) break;
                    Console.WriteLine(ReadDashboardJson(computer));
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

        // =========================================================================
        // FULL THERMAL, AIO/PUMP & FAN CONTROL MODE (on-demand when Thermal Lab is open
        // or custom fan curves are active; always restores hardware Auto on exit!)
        // =========================================================================
        private static int RunThermalLoop(bool onceOnly) {
            Computer computer = null;
            Dictionary<string, IControl> touchedControls = new Dictionary<string, IControl>(StringComparer.OrdinalIgnoreCase);
            try {
                computer = new Computer {
                    IsCpuEnabled = true,
                    IsGpuEnabled = true,
                    IsMotherboardEnabled = true,
                    IsControllerEnabled = true,
                    IsStorageEnabled = true,
                    IsMemoryEnabled = true,
                    IsNetworkEnabled = false
                };
                computer.Open();

                if (onceOnly) {
                    Console.WriteLine(ReadFullThermalJson(computer));
                    return 0;
                }

                Console.WriteLine(ReadFullThermalJson(computer));
                Console.Out.Flush();

                string line;
                while ((line = Console.ReadLine()) != null) {
                    string trimmed = line.Trim();
                    if (string.Equals(trimmed, "EXIT", StringComparison.OrdinalIgnoreCase)) break;

                    if (trimmed.StartsWith("SETFAN ", StringComparison.OrdinalIgnoreCase)) {
                        string rest = trimmed.Substring(7).Trim();
                        int sp = rest.LastIndexOf(' ');
                        if (sp > 0) {
                            string id = rest.Substring(0, sp).Trim();
                            string valStr = rest.Substring(sp + 1).Trim();
                            float pct;
                            if (float.TryParse(valStr, NumberStyles.Float, CultureInfo.InvariantCulture, out pct)) {
                                if (pct < 0f) pct = 0f;
                                if (pct > 100f) pct = 100f;
                                string err = ApplyControl(computer, id, pct, touchedControls);
                                Console.WriteLine(err == null
                                    ? "{\"ok\":true}"
                                    : "{\"ok\":false,\"error\":\"" + EscapeJson(err) + "\"}");
                                Console.Out.Flush();
                                continue;
                            }
                        }
                        Console.WriteLine("{\"ok\":false,\"error\":\"Invalid SETFAN syntax\"}");
                        Console.Out.Flush();
                        continue;
                    }

                    if (trimmed.StartsWith("AUTOFAN ", StringComparison.OrdinalIgnoreCase)) {
                        string id = trimmed.Substring(8).Trim();
                        string err = ResetControl(computer, id, touchedControls);
                        Console.WriteLine(err == null
                            ? "{\"ok\":true}"
                            : "{\"ok\":false,\"error\":\"" + EscapeJson(err) + "\"}");
                        Console.Out.Flush();
                        continue;
                    }

                    if (string.Equals(trimmed, "RESETFANS", StringComparison.OrdinalIgnoreCase)) {
                        RestoreAllControls(touchedControls);
                        Console.WriteLine("{\"ok\":true}");
                        Console.Out.Flush();
                        continue;
                    }

                    Console.WriteLine(ReadFullThermalJson(computer));
                    Console.Out.Flush();
                }
                return 0;
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
                return 1;
            } finally {
                RestoreAllControls(touchedControls);
                try { if (computer != null) computer.Close(); } catch { }
            }
        }

        private static ISensor FindControlSensor(IHardware hw, string id) {
            if (hw.Sensors != null) {
                foreach (ISensor s in hw.Sensors) {
                    if (s.SensorType == SensorType.Control && s.Control != null &&
                        string.Equals(s.Identifier.ToString(), id, StringComparison.OrdinalIgnoreCase)) {
                        return s;
                    }
                }
            }
            if (hw.SubHardware != null) {
                foreach (IHardware sub in hw.SubHardware) {
                    ISensor found = FindControlSensor(sub, id);
                    if (found != null) return found;
                }
            }
            return null;
        }

        private static string ApplyControl(Computer computer, string id, float pct, Dictionary<string, IControl> touched) {
            try {
                foreach (IHardware hw in computer.Hardware) {
                    ISensor s = FindControlSensor(hw, id);
                    if (s != null && s.Control != null) {
                        float minVal = s.Control.MinSoftwareValue;
                        float maxVal = s.Control.MaxSoftwareValue;
                        if (maxVal > minVal) {
                            if (pct < minVal) pct = minVal;
                            if (pct > maxVal) pct = maxVal;
                        }
                        s.Control.SetSoftware(pct);
                        touched[id] = s.Control;
                        return null;
                    }
                }
                return "Fan control channel not found: " + id;
            } catch (Exception ex) {
                return ex.Message;
            }
        }

        private static string ResetControl(Computer computer, string id, Dictionary<string, IControl> touched) {
            try {
                IControl cached;
                if (touched.TryGetValue(id, out cached) && cached != null) {
                    cached.SetDefault();
                    touched.Remove(id);
                    return null;
                }
                foreach (IHardware hw in computer.Hardware) {
                    ISensor s = FindControlSensor(hw, id);
                    if (s != null && s.Control != null) {
                        s.Control.SetDefault();
                        touched.Remove(id);
                        return null;
                    }
                }
                return "Fan control channel not found: " + id;
            } catch (Exception ex) {
                return ex.Message;
            }
        }

        private static void RestoreAllControls(Dictionary<string, IControl> touched) {
            foreach (KeyValuePair<string, IControl> kv in touched) {
                try { if (kv.Value != null) kv.Value.SetDefault(); } catch { }
            }
            touched.Clear();
        }

        private static string HardwareCategory(HardwareType t) {
            switch (t) {
                case HardwareType.Cpu: return "cpu";
                case HardwareType.GpuNvidia:
                case HardwareType.GpuAmd:
                case HardwareType.GpuIntel: return "gpu";
                case HardwareType.Motherboard:
                case HardwareType.SuperIO:
                case HardwareType.EmbeddedController: return "motherboard";
                case HardwareType.Cooler: return "cooler";
                case HardwareType.Storage: return "storage";
                case HardwareType.Memory: return "memory";
                case HardwareType.Psu: return "psu";
                default: return "other";
            }
        }

        private static void CollectHardware(
            IHardware hw,
            string parentName,
            string parentCategory,
            List<string> temps,
            List<string> fans,
            List<string> controls,
            List<string> flows,
            List<string> powers
        ) {
            try { hw.Update(); } catch { return; }
            string cat = HardwareCategory(hw.HardwareType);
            if (cat == "other" && !string.IsNullOrEmpty(parentCategory)) cat = parentCategory;
            string hwName = string.IsNullOrEmpty(hw.Name) ? parentName : hw.Name;
            string displayHw = string.IsNullOrEmpty(parentName) || string.Equals(parentName, hwName, StringComparison.OrdinalIgnoreCase)
                ? hwName
                : (parentName + " · " + hwName);

            if (hw.Sensors != null) {
                foreach (ISensor s in hw.Sensors) {
                    if (!s.Value.HasValue && s.SensorType != SensorType.Control) continue;
                    double v = s.Value.HasValue ? s.Value.Value : 0.0;
                    if (double.IsNaN(v) || double.IsInfinity(v)) continue;
                    string id = s.Identifier != null ? s.Identifier.ToString() : "";
                    string name = s.Name ?? "";

                    if (s.SensorType == SensorType.Temperature && v >= 0.0 && v <= 150.0) {
                        temps.Add(string.Format(
                            CultureInfo.InvariantCulture,
                            "{{\"id\":\"{0}\",\"name\":\"{1}\",\"hardware\":\"{2}\",\"category\":\"{3}\",\"value\":{4},\"min\":{5},\"max\":{6}}}",
                            EscapeJson(id),
                            EscapeJson(name),
                            EscapeJson(displayHw),
                            cat,
                            Math.Round(v, 1).ToString(CultureInfo.InvariantCulture),
                            FmtFloat(s.Min),
                            FmtFloat(s.Max)
                        ));
                    } else if (s.SensorType == SensorType.Fan && v >= 0.0 && v <= 20000.0) {
                        fans.Add(string.Format(
                            CultureInfo.InvariantCulture,
                            "{{\"id\":\"{0}\",\"name\":\"{1}\",\"hardware\":\"{2}\",\"category\":\"{3}\",\"index\":{4},\"rpm\":{5}}}",
                            EscapeJson(id),
                            EscapeJson(name),
                            EscapeJson(displayHw),
                            cat,
                            s.Index,
                            Math.Round(v).ToString(CultureInfo.InvariantCulture)
                        ));
                    } else if (s.SensorType == SensorType.Control) {
                        bool controllable = s.Control != null;
                        float minSw = controllable ? s.Control.MinSoftwareValue : 0f;
                        float maxSw = controllable ? s.Control.MaxSoftwareValue : 100f;
                        string mode = controllable ? s.Control.ControlMode.ToString() : "Undefined";
                        controls.Add(string.Format(
                            CultureInfo.InvariantCulture,
                            "{{\"id\":\"{0}\",\"name\":\"{1}\",\"hardware\":\"{2}\",\"category\":\"{3}\",\"index\":{4},\"percent\":{5},\"controllable\":{6},\"minPct\":{7},\"maxPct\":{8},\"mode\":\"{9}\"}}",
                            EscapeJson(id),
                            EscapeJson(name),
                            EscapeJson(displayHw),
                            cat,
                            s.Index,
                            s.Value.HasValue ? Math.Round(v, 1).ToString(CultureInfo.InvariantCulture) : "null",
                            controllable ? "true" : "false",
                            Math.Round(minSw).ToString(CultureInfo.InvariantCulture),
                            Math.Round(maxSw).ToString(CultureInfo.InvariantCulture),
                            EscapeJson(mode)
                        ));
                    } else if (s.SensorType == SensorType.Flow && v >= 0.0 && v <= 5000.0) {
                        flows.Add(string.Format(
                            CultureInfo.InvariantCulture,
                            "{{\"id\":\"{0}\",\"name\":\"{1}\",\"hardware\":\"{2}\",\"category\":\"{3}\",\"lph\":{4}}}",
                            EscapeJson(id),
                            EscapeJson(name),
                            EscapeJson(displayHw),
                            cat,
                            Math.Round(v, 1).ToString(CultureInfo.InvariantCulture)
                        ));
                    } else if (s.SensorType == SensorType.Power && v >= 0.0 && v <= 1500.0) {
                        if (name.IndexOf("Package", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            name.IndexOf("Total", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            name.IndexOf("Core", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            cat == "cooler" || cat == "psu") {
                            powers.Add(string.Format(
                                CultureInfo.InvariantCulture,
                                "{{\"id\":\"{0}\",\"name\":\"{1}\",\"hardware\":\"{2}\",\"category\":\"{3}\",\"watts\":{4}}}",
                                EscapeJson(id),
                                EscapeJson(name),
                                EscapeJson(displayHw),
                                cat,
                                Math.Round(v, 1).ToString(CultureInfo.InvariantCulture)
                            ));
                        }
                    }
                }
            }

            if (hw.SubHardware != null) {
                foreach (IHardware sub in hw.SubHardware) {
                    CollectHardware(sub, hwName, cat, temps, fans, controls, flows, powers);
                }
            }
        }

        private static string ReadFullThermalJson(Computer computer) {
            List<string> temps = new List<string>();
            List<string> fans = new List<string>();
            List<string> controls = new List<string>();
            List<string> flows = new List<string>();
            List<string> powers = new List<string>();

            foreach (IHardware hw in computer.Hardware) {
                CollectHardware(hw, "", HardwareCategory(hw.HardwareType), temps, fans, controls, flows, powers);
            }

            StringBuilder sb = new StringBuilder(4096);
            sb.Append("{\"temperatures\":[");
            sb.Append(string.Join(",", temps));
            sb.Append("],\"fans\":[");
            sb.Append(string.Join(",", fans));
            sb.Append("],\"controls\":[");
            sb.Append(string.Join(",", controls));
            sb.Append("],\"flows\":[");
            sb.Append(string.Join(",", flows));
            sb.Append("],\"powers\":[");
            sb.Append(string.Join(",", powers));
            sb.Append("]}");
            return sb.ToString();
        }

        private static string ReadDashboardJson(Computer computer) {
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

        private static string FmtFloat(float? val) {
            return val.HasValue && !float.IsNaN(val.Value) && !float.IsInfinity(val.Value)
                ? Math.Round(val.Value, 1).ToString(CultureInfo.InvariantCulture)
                : "null";
        }

        private static string FmtFloat(double? val) {
            return val.HasValue && !double.IsNaN(val.Value) && !double.IsInfinity(val.Value)
                ? Math.Round(val.Value, 1).ToString(CultureInfo.InvariantCulture)
                : "null";
        }

        private static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
        }
    }
}
