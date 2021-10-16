const http_request = require('./http_request');
const Zip = require('adm-zip');

const main = async () => {

    const res = await http_request("https://download.geonames.org/export/zip/SE.zip")

    if(res.statusCode != 200){
        return;
    }

    const prop_indicies = {
        'zipcode': 1,
        'city': 2,
        'county': 3,
        'municipality': 5,
        'lat': 9,
        'lng': 10,
    }

    const props = Object.entries(prop_indicies)

    const zip = new Zip(res.body);
    const zipEntries = zip.getEntries();
    const zipcodes = zipEntries
        .filter(e => e.name == "SE.txt")
        .map(e => e
            .getData()
            .toString('utf8')
            .split("\n")
        ).flat()
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
    console.log(JSON.stringify(zipcodes, null, 2))
    console.error(`Exported ${zipcodes.length} zipcodes`);
}

main()
