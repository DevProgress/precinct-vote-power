var path = require('path');

var data = '../data/';
var dist = '../dist/';

module.exports = {
    dist: dist,
    data: {
        topo: {
            dist: path.join(dist, 'topo'),
            usTopoData: path.join(data, 'topo', '*.*')
        },
        census: {
            population: {
                counties_2012: path.join(data, 'census', 'us-census-bureau-2010-2014', 'County.csv')
            },
            areas: {
                counties_2012: path.join(data, 'census', 'us-census-county-area-2012', '2012_Gaz_counties_national.txt')
            },
            counties: {
                dist: path.join(dist, 'census', 'counties'),
                alaska: path.join(data, 'census', 'counties', 'census.gov', 'st02_ak_cou.csv'),
            },
            precincts: {
                dist: path.join(dist, 'census', 'precincts'),
                alaska: path.join(data, 'census', 'precincts', 'eda-harvard.edu', 'ak_precincts.csv'),
                alaska_unorganized: {
                    jber: "02020",
                    rogerspark: "02020",
                    northmtview: "02020",
                    southmtview: "02020",
                    downtownanch: "02020",
                    omalley: "02020",
                    chugachfthills: "02020",
                    sewardlowellpoint: "02122",
                    foxriver: "02122",
                    tenakeesprings: "02105",
                    northprinceofwales: "02198",
                    lakeiliamna: "02164",
                    stgeorgeisland: "02013"
                }
            }
        },
        elections: {
            candidates: {
                usp: path.join(data, 'elections', 'candidates', 'usp-candidate-names.json'),
            },
            president: {
                counties: {
                    dist: path.join(dist, 'elections', 'president', 'counties'),
                    huffpost_2012: path.join(data, 'elections', 'counties', 'huffingtonpost-USP-2012', '*.csv')
                },
                precincts: {
                    huffpost_2012_AK: path.join(data, 'elections', 'precincts', 'huffingtonpost-USP-2012', 'ak_precincts.csv'),
                    huffpost_2012_AK_Output: path.join(data, 'elections', 'counties',
                    'huffingtonpost-USP-2012'),
                }
            }
        }
    }
};
