"""Daily rain and mean temperature for Madrid city, median of the city's weather stations.

Reads the city open data catalogue (datos.madrid.es, dataset 300351, one wide CSV per year) and writes data/tiempo.csv
with day,rain_mm,temp_c from 2024-01-01. Standard library only. Run by .github/workflows/tiempo.yml every month.
"""
import csv, io, json, statistics, urllib.request
from collections import defaultdict

API = "https://datos.madrid.es/api/3/action/package_show?id=300351-0-meteorologicos-diarios"
RAIN, TEMP = "89", "83"


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def main():
    resources = json.loads(get(API))["result"]["resources"]
    vals = defaultdict(lambda: defaultdict(list))
    for res in resources:
        if res.get("format") != "CSV":
            continue
        text = get(res["url"]).decode("latin-1")
        rows = list(csv.DictReader(io.StringIO(text), delimiter=";"))
        if not rows:
            continue
        for r in rows:
            r = {k.strip('"'): (v or "").strip('"') for k, v in r.items() if k}
            if r.get("MAGNITUD") not in (RAIN, TEMP) or not r.get("ANO", "").isdigit() or int(r["ANO"]) < 2024:
                continue
            for d in range(1, 32):
                v, ok = r.get(f"D{d:02d}"), r.get(f"V{d:02d}")
                if v and ok == "V":
                    vals[f"{r['ANO']}-{int(r['MES']):02d}-{d:02d}"][r["MAGNITUD"]].append(float(v.replace(",", ".")))
    with open("data/tiempo.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["day", "rain_mm", "temp_c"])
        for day in sorted(vals):
            m = vals[day]
            w.writerow([day, round(statistics.median(m[RAIN]), 1) if m[RAIN] else "", round(statistics.median(m[TEMP]), 1) if m[TEMP] else ""])
    print("days", len(vals), "last", max(vals))


if __name__ == "__main__":
    main()
