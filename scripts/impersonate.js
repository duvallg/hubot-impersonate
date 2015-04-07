//Description:
//  Impersonate a user using Markov chains
//
//Dependencies:
//  markov-respond: ~6.0.0
//  underscore: ~1.7.0
//  msgpack: ~0.2.4
//
//Configuration:
//  HUBOT_IMPERSONATE_MODE=mode - one of 'train', 'train_respond', 'respond'. (default 'train')
//  HUBOT_IMPERSONATE_MIN_WORDS=N - ignore messages with fewer than N words. (default 1)
//  HUBOT_IMPERSONATE_INIT_TIMEOUT=N - wait for N milliseconds for brain data to load from redis. (default 10000)
//  HUBOT_IMPERSONATE_CASE_SENSITIVE=true|false - whether to keep the original case of words (default false)
//  HUBOT_IMPERSONATE_STRIP_PUNCTUATION=true|false - whether to strip punctuation/symbols from messages (default false)
//  HUBOT_IMPERSONATE_RESPONSE_DELAY_PER_WORD=N - simulate time to type a word, as a baseline, in milliseconds. (default 600)
//
//Commands:
//  hubot impersonate <user> - impersonate <user> until told otherwise.
//  hubot stop impersonating - stop impersonating a user
//
//Author:
//  b3nj4m

var Markov = require('markov-respond');
var _ = require('underscore');
var msgpack = require('msgpack');

var MIN_WORDS = process.env.HUBOT_IMPERSONATE_MIN_WORDS ? parseInt(process.env.HUBOT_IMPERSONATE_MIN_WORDS) : 1;
var MODE = process.env.HUBOT_IMPERSONATE_MODE && _.contains(['train', 'train_respond', 'respond'], process.env.HUBOT_IMPERSONATE_MODE) ? process.env.HUBOT_IMPERSONATE_MODE : 'train';
var INIT_TIMEOUT = process.env.HUBOT_IMPERSONATE_INIT_TIMEOUT ? parseInt(process.env.HUBOT_IMPERSONATE_INIT_TIMEOUT) : 10000;
var CASE_SENSITIVE = (!process.env.HUBOT_IMPERSONATE_CASE_SENSITIVE || process.env.HUBOT_IMPERSONATE_CASE_SENSITIVE === 'false') ? false : true;
var STRIP_PUNCTUATION = (!process.env.HUBOT_IMPERSONATE_STRIP_PUNCTUATION || process.env.HUBOT_IMPERSONATE_STRIP_PUNCTUATION === 'false') ? false : true;
var RESPONSE_DELAY_PER_WORD = process.env.HUBOT_IMPERSONATE_INIT_TIMEOUT ? parseInt(process.env.HUBOT_IMPERSONATE_INIT_TIMEOUT) : 600; // in milliseconds

var shouldTrain = _.constant(_.contains(['train', 'train_respond'], MODE));

var shouldRespondMode = _.constant(_.contains(['respond', 'train_respond'], MODE));

function robotStore(robot, userId, data) {
    return robot.brain.set('impersonateMarkov-' + userId, msgpack.pack(data.export()));
}

function robotRetrieve(robot, cache, userId) {
    if (cache[userId]) {
        return cache[userId];
    }

    var data = msgpack.unpack(new Buffer(robot.brain.get('impersonateMarkov-' + userId) || ''));
    data = _.isObject(data) ? data : {};

    var m = new Markov(MIN_WORDS, CASE_SENSITIVE, STRIP_PUNCTUATION);
    m.import(data);
    cache[userId] = m;

    return m;
}

function start(robot) {
    var impersonating = false;

    function shouldRespond() {
        return shouldRespondMode() && impersonating;
    }

    var cache = {};
    var store = robotStore.bind(this, robot);
    var retrieve = robotRetrieve.bind(this, robot, cache);

    robot.brain.setAutoSave(true);

    var hubotMessageRegex = new RegExp('^[@]?(' + robot.name + ')' + (robot.alias ? '|(' + robot.alias + ')' : '') + '[:,]?\\s', 'i');

    robot.respond(/impersonate (\w*)/i, function(msg) {
        if (shouldRespondMode()) {
            var username = msg.match[1];
            var text = msg.message.text;

            var users = robot.brain.usersForFuzzyName(username);

            if (users && users.length > 0) {
                var user = users[0];
                if (user.name !== robot.name) {
                    impersonating = user.id;
                    msg.send("Alright. I'm now impersonating " + user.name + ".");
                } else {
                    msg.send("Impersonating yourself? How meta.");
                }
            } else {
                msg.send("I don't know anyone by the name of " + username + ".");
            }
        }
    });

    robot.respond(/stop impersonating/i, function(msg) {
        if (shouldRespond()) {
            var user = robot.brain.userForId(impersonating);
            impersonating = false;

            if (user) {
                msg.send("Fine, I've stopped impersonating " + user.name + ".");
            } else {
                msg.send("I don't recognize that user, but I've impersonating anyway.");
            }
        } else {
            msg.send("I wasn't impersonating anyone to begin with.");
        }
    });

    robot.hear(/.*/, function(msg) {
        var text = msg.message.text;
        var markov;

        if (text && !hubotMessageRegex.test(text)) {
            if (shouldTrain()) {
                var userId = msg.message.user.id;
                markov = retrieve(userId);
                markov.train(text);
                store(userId, markov);
            }

            // TODO: Add condition for addressing direct messages to Hubot versus ambient participation. (Non-random vs. Random)
            if (shouldRespond() && (Math.floor(Math.random() * (31 - 1)) + 1 > Math.floor(Math.random() * (31 - 1)) + 1)) {
                markov = retrieve(impersonating);
                var markovResponse = markov.respond(text);
                var baseDelay = RESPONSE_DELAY_PER_WORD * markovResponse.split(" ").length;
                var totalDelay = Math.random() * (baseDelay * 1.5 - baseDelay * 0.75) + baseDelay * 0.75;
                setTimeout(function() {
                    msg.send(markovResponse);
                }, totalDelay);
            }
        }
    });
}

module.exports = function(robot) {
    var loaded = _.once(function() {
        console.log('starting hubot-impersonate...');
        start(robot);
    });

    if (_.isEmpty(robot.brain.data) || _.isEmpty(robot.brain.data._private)) {
        robot.brain.once('loaded', loaded);
        setTimeout(loaded, INIT_TIMEOUT);
    } else {
        loaded();
    }
};