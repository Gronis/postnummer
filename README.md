# postnummer

Fetch Swedish zipcodes and metadata such as their closest city, county, municipality and geo-coordinates. The data is fetched from geonames.org which in turns fetch data from the swedish authorities.

### Original data sources:
- scb	Statistics Sweden	http://www.scb.se/
- bebyggelseregistret	Data Base of Built Heritage	http://www.bebyggelseregistret.raa.se
- lantmateriet	Swedish National Land Survey	http://www.lantmateriet.se/	CCBY
- valmyndigheten	Swedish Election Authority

Reference: http://www.geonames.org/countries/SE/kingdom-of-sweden.html

## Usage
Build and fetch data to `zipcodes.json` file
```bash
npm install
npm run start
```
## Example
Print zipcode `111 23` and its metadata
```bash
cat zipcodes.json | grep '111 23' -B 1 -A 6
```
Output:
```json
  {
    "zipcode": "111 23",
    "city": "Stockholm",
    "county": "Stockholm",
    "municipality": "Stockholm",
    "lat": "59.3326",
    "lng": "18.0649"
  },
```