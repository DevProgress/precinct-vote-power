var gulp = require('gulp-help')(require('gulp'));
var paths = require('../paths');
var csv = require('csv');
var fs = require('fs');
var co = require('co');
var csv2json = require('gulp-csv2json');
var rename = require('gulp-rename');
var jsonCombine = require('gulp-jsoncombine');
var dbf = require('node-dbf');
var request = require('request');
var convert = require('gulp-convert');

var nameLookup = {};
var stateCountyLookup = {};
var fipsToStateCodes = {};
var scales = {};
var statePrecinctCountyLookup = {};

function normalizeCandiateName(name) {
    name = name.toLowerCase().trim();

    if (nameLookup[name]) {
        name = nameLookup[name].name;
    } else {
        name = 'O';
    }
    return name;
}

function normalizePrecinctName(precinct) {
    return precinct.replace(/\([A-Z0-9\s;]+\)/ig, '')
        .replace(/[\'\"\/\s\.\-]/ig, "").toLowerCase()
        .replace('precinct', '');
}

function searchPrecinctFips(state, p) {
    let precinctSearch = p;
    let numericPath = p.split(/ No\. [0-9]+/);
    if (numericPath.length > 1) {
        precinctSearch = numericPath[0].trim();
    }
    let slashPath = p.split(/\/[A-Za-z]+/);
    if (slashPath.length > 1) {
        precinctSearch = slashPath[0];
    }

    precinctSearch = normalizePrecinctName(precinctSearch);

    let results = [];
    if (statePrecinctCountyLookup[state]) {
        let keys = Object.keys(statePrecinctCountyLookup[state]);
        keys.sort();
        for (let i = 0; i < keys.length; i++) {
            let k = keys[i];
            if (k.indexOf(precinctSearch) > -1) {
                results.push(statePrecinctCountyLookup[state][k]);
                if (k === p || k === precinctSearch) {
                    return [statePrecinctCountyLookup[state][k]];
                }
            }
        }

        if (results.length === 0) {
            let fips = paths.data.census.precincts.alaska_unorganized[precinctSearch];
            if (fips) {
                return [{
                    fips: fips,
                    county: stateCountyLookup[state][fips].name
                }];
            }
            console.error('NO RESULTS', precinctSearch, p);
        }
    }

    return results;
}

function normalizeStateCountyVotes(state, items, candidateParties) {
    return items.map(item => {
        let name = normalizeCandiateName(item.candidate);
        let party = name;
        if (nameLookup[name]) {
            party = nameLookup[name].party;
            if (!candidateParties[party]) {
                candidateParties[party] = name;
            }
        }
        if (!stateCountyLookup[state]) {
            stateCountyLookup[state] = {};
        }
        if (!stateCountyLookup[state][item.fips]) {
            stateCountyLookup[state][item.fips] = { name: item.county };
        }
        return {
            fips: item.fips,
            county: item.county,
            party: party,
            candidate: normalizeCandiateName(item.candidate),
            votes: parseInt(item.votes, 10)
        };
    });
}

function aggregateStateVotesByFIPS(state, items, usCandidates, candidateParties) {
    items = normalizeStateCountyVotes(state, items, candidateParties);
    let fipsVotes = {};
    for (let i = 0; i < items.length; i++) {
        let item = items[i];
        if (!fipsVotes[item.fips]) {
            fipsVotes[item.fips] = {};
        }
        let fipsEntry = fipsVotes[item.fips];
        if (!fipsEntry[item.party]) {
            fipsEntry[item.party] = { k: item.party, v: 0 };
        }
        if (!usCandidates[item.party]) {
            usCandidates[item.party] = 0;
        }
        fipsEntry[item.party].v += item.votes;
        usCandidates[item.party] += item.votes;
    }
    return fipsVotes;
}

function processStateVotesByFIPS(state, stateTotal, fipsVotes) {
    let counties = Object.keys(fipsVotes).map(fips => {
        let candidates = Object.keys(fipsVotes[fips]);
        let votes = candidates.map(c => fipsVotes[fips][c]);
        let result = {
            fips: fips,
            county: stateCountyLookup[state][fips],
            popular: {},
            winner: '',
            total: 0,
            percent: {},
            diff: {
                votes: 0,
                percent: 0
            }
        };

        votes.sort((a, b) => b.v - a.v);
        result.winner = votes[0].k;
        result.diff.votes = votes[0].v - votes[1].v;
        let total = 0;
        votes.forEach(v => {
            if (!stateTotal[v.k]) {
                stateTotal[v.k] = 0;
            }
            stateTotal[v.k] += v.v;
            result.popular[v.k] = result.popular[v.k] || 0;
            result.popular[v.k] += v.v;
            total += v.v;
        });

        result.total = total;

        votes.forEach(v => {
            result.percent[v.k] = parseInt((v.v / total) * 1000) / 1000;
        });

        result.diff.percent = parseInt((result.percent[votes[0].k] - result.percent[votes[1].k]) * 100) / 100;

        return result;
    });

    counties.sort((a, b) => a.diff.votes - b.diff.votes);
    return counties;
}

function processAggregateTotals(result, totals) {
    let popularKeys = Object.keys(totals);
    let popularItems = popularKeys.map(p => { return { k: p, v: totals[p] }; });
    popularItems.sort((a, b) => b.v - a.v);

    let total = 0;
    result.popular = totals;
    result.percent = {};
    result.winner = '';
    result.diff = { votes: 0, percent: 0 };
    popularItems.forEach(item => {
        total += item.v;
    });
    result.total = total;
    result.winner = popularItems[0].k;
    popularItems.forEach(item => {
        result.percent[item.k] = parseInt((item.v / total) * 1000) / 1000;
    });
    result.diff.votes = popularItems[0].v - popularItems[1].v;
    result.diff.percent = parseInt((result.percent[popularItems[0].k] - result.percent[popularItems[1].k]) * 100) / 100;
    return result;
}

function buildElectionResultsFromCountyData(scale, data) {
    let usCandidates = {};
    let candidateParties = {};
    let stateResults = {};
    Object.keys(data).forEach(k => {
        let state = k.toUpperCase();
        let stateTotal = {};
        let fipsVotes = aggregateStateVotesByFIPS(state, data[k], usCandidates, candidateParties);
        let counties = processStateVotesByFIPS(state, stateTotal, fipsVotes);
        let result = { counties };
        stateResults[state] = processAggregateTotals(result, stateTotal);
    });

    let result = { candidates: candidateParties, states: stateResults, chromaticScale: scale };
    return processAggregateTotals(result, usCandidates)
}

gulp.task('build-usp-candidates', [], function () {
    return gulp.src(paths.data.elections.candidates.usp)
        .pipe(jsonCombine('usp-candidate-names.json', function (data) {
            Object.keys(data).forEach(k => {
                let item = data[k];
                Object.keys(item).forEach(year => {
                    let elections = item[year];
                    if (!scales[year]) {
                        scales[year] = {};
                    }
                    Object.keys(elections).forEach(electionType => {
                        let election = elections[electionType];
                        if (!scales[year][electionType]) {
                            scales[year][electionType] = election.meta.chromatics;
                        }
                        Object.keys(election).forEach(name => {
                            if (name === 'meta') {
                                return;
                            }
                            election[name].alternatives.forEach(alt => {
                                nameLookup[alt] = election[name];
                            });
                            nameLookup[name] = election[name];
                            nameLookup[election[name].name] = election[name];
                        });
                    });
                });
            });
        }));
});

gulp.task('build-areas-counties-2012', 'Builds the 2012 Census areas per county', [], function (cb) {
    let file = fs.createReadStream(paths.data.census.areas.counties_2012);
    let headers = [];
    let dataItems = [];
    file.on('data', (data) => {
        let lines = data.toString().split(/\r\n|\n|\r|\n\r/);

        lines.forEach(line => {
            let items = line.split('\t').map(s => s.trim());
            if (headers.length === 0) {
                headers = items.map(s => s.toLowerCase());
            } else {
                let obj = Object.create(null);
                headers.forEach((h, i) => {
                    obj[h] = items[i];
                });
                let keys = ['aland', 'aland_sqmi', 'awater', 'awater_sqmi', 'intptlat', 'intptlong'];
                keys.forEach(k => {
                    obj[k] = parseFloat(obj[k]);
                });
                if (!stateCountyLookup[obj.usps]) {
                    stateCountyLookup[obj.usps] = {};
                }
                stateCountyLookup[obj.usps][obj.geoid] = obj;
                if (!fipsToStateCodes[obj.geoid]) {
                    fipsToStateCodes[obj.geoid] = obj.usps;
                }
                dataItems.push(obj);
            }
        });
    });

    file.on('end', () => {
        cb();
    });
});

gulp.task('build-us-census-2012', 'Builds the US Census population per county', ['build-areas-counties-2012'], function () {
    return gulp.src(paths.data.census.population.counties_2012)
        .pipe(csv2json({}))
        .pipe(jsonCombine('us-county-census-2012.json', function (data) {
            Object.keys(data).forEach(k => {
                let items = data[k];
                items.forEach(item => {
                    if (item.LNTITLE === 'Total') {
                        let geoid =item.GEOID;
                        let geoIds = geoid.split('US');
                        if (geoIds.length > 1) {
                            let fips = geoIds[1];
                            let state = fipsToStateCodes[fips];
                            if (state) {
                                let county = stateCountyLookup[state][fips];
                                if (county) {
                                    county.population = {
                                        totalEst: parseInt(item.TOT_EST),
                                        totalErr: parseInt(item.TOT_MOE),
                                        adultEst: parseInt(item.ADU_EST),
                                        adultErr: parseInt(item.ADU_MOE),
                                        citizenEst: parseInt(item.CIT_EST),
                                        citizenErr: parseInt(item.CIT_MOE),
                                        citizenAdultEst: parseInt(item.CVAP_EST),
                                        citizenAdultErr: parseInt(item.CVAP_MOE)
                                    };
                                }
                            }
                        }
                    }
                });
            });
        }));
});

gulp.task('build-ak-precincts', 'Builds the precinct GIS data to obtain proper FIPS codes per precinct based', ['build-us-census-2012'], function () {
    return gulp.src(paths.data.census.precincts.alaska)
        .pipe(csv2json({}))
        .pipe(jsonCombine('ak.json', function (data) {
            let state = 'AK';
            Object.keys(data).forEach(k => {
                let items = data[k];
                items.forEach(item => {
                    let fips = item.STATEFP10 + item.COUNTYFP10;
                    let precinct = item.NAME10.replace(/\([A-Z0-9\s;]+\)/ig, '').trim();
                    let name = precinct.replace(/\sprecinct/ig, "");
                    let precinctId = normalizePrecinctName(precinct);
                    statePrecinctCountyLookup[state] = statePrecinctCountyLookup[state] || {};
                    statePrecinctCountyLookup[state][precinctId] = {
                        precinct: name,
                        county: stateCountyLookup[state][fips].name,
                        fips: fips
                    };
                });
            });
            return new Buffer(JSON.stringify(statePrecinctCountyLookup[state]));
        }))
        .pipe(gulp.dest(paths.data.census.precincts.dist));
});

gulp.task('build-usp-2012-ak-precincts', 'Builds the Alaska precincts into counties based on the Huffington Post 2012 Presidential Election Results', ['build-ak-precincts'], function () {
    return gulp.src(paths.data.elections.president.precincts.huffpost_2012_AK)
        .pipe(csv2json({}))
        .pipe(jsonCombine('ak.csv', function (data) {
            let results = [{ fips: "fips", county: "county", candidate: "candidate", votes: "votes" }];
            Object.keys(data).forEach(k => {
                let items = data[k];
                let state = k.replace("_precincts", "").toUpperCase();
                items.forEach(item => {
                    let precinct = item.precinct.split(/[0-9]+-[0-9]+ /);
                    if (precinct.length > 1) {
                        let lookup = searchPrecinctFips(state, precinct[1]);
                        if (lookup.length > 0) {
                            results.push({
                                fips: lookup[0].fips,
                                county: lookup[0].county,
                                candidate: item.candidate,
                                votes: parseInt(item.votes, 10)
                            });
                        }
                    } else {
                        results.push({
                            fips: '',
                            county: 'Absentee/Early/Question',
                            candidate: item.candidate,
                            votes: item.votes
                        });
                    }
                });
            });

            return new Buffer(JSON.stringify(results));
        }))
        .pipe(convert({
            from: 'json',
            to: 'csv'
        }))
        .pipe(gulp.dest(paths.data.elections.president.precincts.huffpost_2012_AK_Output));
});

gulp.task('build-usp-2012-counties', 'Builds the counties compiled data based on the Huffington Post 2012 Presidential Election results', ['build-usp-candidates', 'build-usp-2012-ak-precincts'], function () {
    return gulp.src(paths.data.elections.president.counties.huffpost_2012)
        .pipe(csv2json({}))
        .pipe(jsonCombine('2012.json', function (data) {
            return new Buffer(JSON.stringify(buildElectionResultsFromCountyData(scales['2012']['president'], data)));
        }))
        .pipe(gulp.dest(paths.data.elections.president.counties.dist));
});
