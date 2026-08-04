import { describe, expect, it } from "vitest";
import { parseMetricsCollectOutput } from "./netdata-client.js";

describe("parseMetricsCollectOutput", () => {
  it("parses netdata gauges and alarms", () => {
    const out = `===OPS_NETDATA_AVAILABLE===
yes
===OPS_NETDATA_GAUGE_system.cpu===
{"labels":["time","user","system"],"data":[[1,5.1,2.0]]}
===OPS_NETDATA_GAUGE_nginx_local.connections===
{"labels":["time","active"],"data":[[1,2]]}
===OPS_NETDATA_GAUGE_nginx_local.requests===
{"labels":["time","requests"],"data":[[1,22.8]]}
===OPS_NETDATA_ALARMS===
{"alarms":{"10min_cpu_usage":{"status":"CLEAR","value_string":"7.58%"},"ram_in_use":{"status":"CLEAR","value_string":"7.74%"}}}
===OPS_STUB_STATUS===
Active connections: 2
server accepts handled requests
 100 200 300
Reading: 0 Writing: 1 Waiting: 0
`;
    const snap = parseMetricsCollectOutput(out);
    expect(snap.netdataAvailable).toBe(true);
    expect(snap.gauges[0]?.formatted).toContain("%");
    expect(snap.status.length).toBeGreaterThan(0);
    expect(snap.stubStatus?.active).toBe(2);
  });

  it("parses network from net chart and /proc/net/dev fallback", () => {
    const out = `===OPS_NETDATA_AVAILABLE===
yes
===OPS_NETDATA_NET_CHART===
{"labels":["time","received","sent"],"data":[[1,120.5,45.2]]}
===OPS_NETDATA_IFACE_NAME===
net.ens5
===OPS_PROC_NET_RATE===
ens5 1000 2000 2008 4016
`;
    const snap = parseMetricsCollectOutput(out);
    const netIn = snap.gauges.find((g) => g.id === "net.received");
    const netOut = snap.gauges.find((g) => g.id === "net.sent");
    expect(netIn?.value).toBe(120.5);
    expect(netOut?.value).toBe(45.2);
    expect(snap.interfaceName).toBe("ens5");
  });
});
