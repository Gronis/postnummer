const fs = require('fs').promises;
const zip = require('./zip');
const http_request = require('./http_request');

const main = async () => {
    let modified_timestamp = null;
    try{
        stats = await fs.stat('zipcodes.json')
        modified_timestamp = stats.mtime.toUTCString();
    } catch (_){}

    const headers = {

    }

    // Tell the server when we the last update was fetched.
    if(modified_timestamp){
        headers['If-Modified-Since'] = modified_timestamp
    }

    const res = await http_request("https://download.geonames.org/export/zip/SE.zip", { 
        headers,
        buffer: true,
    })

    if(res.statusCode == 304){
        console.error(`No changes`);
        return;
    }

    if(res.statusCode != 200){
        console.log("Error: Didn't get status 200:", res)
        return;
    }

    const props = Object.entries({
        'zipcode': 1,
        'city': 2,
        'county': 3,
        'municipality': 5,
        'lat': 9,
        'lng': 10,
    })

    const zipcodes = zip.Reader(res.body).toArray()
        .filter(e => e.getName() == "SE.txt")
        .map(e => e.getData().toString('utf8').split("\n"))
        .flat()
        .map(l => {
            const attrs = l.split('\t')
            if(attrs.length < 10){
                return null
            }
            const obj = {}
            props.forEach(([attr, i]) => obj[attr] = attrs[i])
            return obj
        })
        .filter(e => !!e)
    {
        const zipcodes_json = await fs.open('zipcodes.json', 'w')
        await fs.writeFile(zipcodes_json, JSON.stringify(zipcodes, null, 2))
        zipcodes_json.close()
    }
    console.error(`Exported ${zipcodes.length} zipcodes to zipcodes.json`);
}

main()
