# Replacing the station list

The station master shipped with the system is indicative. The authoritative list comes from the
division, and goes in without a code change.

## The file

Send the works office [`station-list-template.csv`](station-list-template.csv), or export what is in
the system now (**Admin &rarr; Master data &rarr; Station &rarr; Import &rarr; Export the current
list**) and have them correct it. Either way the file comes back as CSV.

| Column | Required | Notes |
| --- | --- | --- |
| `Station Code` | yes | The station code. This is what identifies a station: a code already in the system is **updated**, a new one is **added** |
| `Station Name` | yes | |
| `Division` | recommended | Divisional code (`JBP`, `BPL`, …). Left blank, the default division from Settings is used; a division the system does not know makes the row fail with that reason |
| `Zone` | no | Zonal code (`WCR`, …). Left blank, it is taken from the division |
| `Category` | no | `NSG-1` &hellip; `NSG-6`, `SG-…`, `HG-…` |
| `Station Type` | no | Junction, Station, Halt, Terminal, Flag &hellip; |
| `Section` | no | The section the station sits on, e.g. `Katni - Itarsi`. Used to group the station list and to describe a supervisor's section |
| `No. of Platforms` | no | Also controls which platforms the Unit list offers, so a two-platform halt stops showing Platform No. 6 |
| `Latitude`, `Longitude` | no | |
| `Active` | no | `0` takes the station out of the lists without deleting it |

Column headings do not have to match exactly. Headings are read case-insensitively, spaces and full
stops become underscores, and the usual office variants are understood &mdash; `Station Code`,
`STN CODE` and `code` all mean the same column, as do `No. of Platforms`, `Number of Platforms`,
`PF` and `platforms`. Anything the system does not recognise is ignored rather than rejected, and
the error message lists the headings it actually found.

## Loading it

**Admin &rarr; Master data &rarr; Station &rarr; Import**, then either paste the CSV or choose the
file.

1. **Check** first. Nothing is written. The result says how many stations would be added, updated,
   deactivated and skipped, and names the line number and the reason for every skipped row.
2. Fix whatever it reports, then **Import**.

Tick **"Deactivate the stations not in this file"** only when the file is the complete divisional
list. Stations left out are then marked inactive: they stop being offered on the inspection screen
but stay in the database, so observations already recorded against them still open correctly.

## What is never done

Nothing is deleted. A station that has to go is deactivated, because inspections, observations and
inspection notes point at it and history has to stay readable. The same applies to every other
master in the system.

## Afterwards

Two things to check once the real list is in:

* **Supervisors** (Admin &rarr; Supervisors) &mdash; each supervisor's stations decide where the
  system finds them. A section inspector should carry every station on their section, not only the
  one they are posted at.
* **Station areas** (Admin &rarr; Master data &rarr; Unit / Area) &mdash; platforms, booking hall,
  waiting rooms and so on are shared across all stations by default. Anything specific to one
  station is added there with that station selected.
