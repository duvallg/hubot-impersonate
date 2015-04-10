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
//  HUBOT_IMPERSONATE_FREQUENCY_THRESHOLD=N - on a scale of 0-100, what randomized number has to be exceeded. (default 50)
//
//Commands:
//  hubot impersonate <user> - impersonate <user> until told otherwise.
//  hubot who are you impersonating - find out which user is being impersonated.
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
var FREQUENCY_THRESHOLD = process.env.HUBOT_IMPERSONATE_FREQUENCY_THRESHOLD ? parseInt(process.env.HUBOT_IMPERSONATE_FREQUENCY_THRESHOLD) : 50;
var RESTRICTED_AREAS = ['general'];

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
                    msg.send("Alright, I'll impersonate " + user.name + ".");
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
                msg.send("Fine, I'll shut up now.");
            } else {
                msg.send("I don't recognize that user, but I've stopped impersonating anyway.");
            }
        } else {
            msg.send("I wasn't impersonating anyone to begin with.");
        }
    });

    robot.hear(/.*/, function(msg) {
        if (RESTRICTED_AREAS[0] != user.room) {
            var text = msg.message.text;
            var markov;

            if (text && !hubotMessageRegex.test(text)) {
                if (shouldTrain()) {
                    var userId = msg.message.user.id;
                    markov = retrieve(userId);
                    markov.train(text);
                    store(userId, markov);
                }

                // TODO: Add condition for addressing direct messages to Hubot versus ambient participation.
                // TODO: Make this a configurable setting at some point and simplify implementation
                // PROTIP: Make sure this doesn't conflict with other/expiringd deps, so look for instances not in [0]
                if (shouldRespond() && (_.random(0, 100) > FREQUENCY_THRESHOLD) && RESTRICTED_AREAS[0] != user.room) {
                    markov = retrieve(impersonating);
                    var markovResponse = markov.respond(text);
                    var baseDelay = RESPONSE_DELAY_PER_WORD * markovResponse.split(" ").length;
                    var totalDelay = Math.random() * (baseDelay * 1.5 - baseDelay * 0.75) + baseDelay * 0.75;
                    setTimeout(function() {
                        msg.send(markovResponse);
                    }, totalDelay);
                }
            }
        }
    });

    robot.respond(/who are you impersonating/i, function(msg) {
        if (shouldRespond()) {
            var user = robot.brain.userForId(impersonating);
            if (user) {
                msg.send("I'm currently impersonating " + user.name + ".");
            } else {
                msg.send("Nobody.");
            }
        } else {
            msg.send("Nobody.");
        }
    });

    robot.respond(/what room are we in/i, function(msg) {
        if (shouldRespond()) {
            msg.send("We are in room " + msg.message.room);
        } else {
            msg.send("We are in room " + msg.message.room);
        }
    });

    robot.respond(/what rooms can't you impersonate in/i, function(msg) {
        if (shouldRespond() && RESTRICTED_AREAS) {
            msg.send(msg.message.room);
        } else {
            msg.send(msg.message.room);
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