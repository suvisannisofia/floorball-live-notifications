/**
 * The entry point for this project. Starts the tracker daemon.
 */

require('dotenv').load();

// dependencies
var _ = require('lodash');
var async = require('async');
var floorball = require('./lib/floorball-api');

var Pushover = require( 'pushover-notifications' );
var pushover = new Pushover( {
  user: process.env['PUSHOVER_USER'],
  token: process.env['PUSHOVER_TOKEN'],
});

var liveGameIDs; // last updated
var gameTimes = {}; // last updated
var gameEvents = {}; // last updated

var mainLoop = function() {
  // get games currently in progress
  floorball.get('/games/upcoming/' + process.env['FLOORBALL_GROUP_ID']).on('complete', findLiveGames);
};

var findLiveGames = function(result) {
  // filter games in progress from all upcoming games
  var myTeams = _.map(process.env['FLOORBALL_MY_TEAMS'].split(','), function(a) { return parseInt(a,10); });

  var liveGames = _.filter(result.games, function(game) { 
    // does the game feature my teams ?
    if(_.includes(myTeams, game.awayTeam) || _.includes(myTeams, game.homeTeam)) {
      // is the game in progress ?
      if(game.inProgress) {
        return true;
      }
    }
    return false;
  });

  var prevLiveGameIDs = liveGameIDs || -1;
  liveGameIDs = _.map(liveGames, function(game) { return game.game; });

  async.each(liveGames, updateGames, function() {

    // after all live games have been updated

    var newLiveGames = _.filter(liveGames, function(game) { return !_.contains(prevLiveGameIDs, game.game) });
    if(newLiveGames.length && prevLiveGameIDs !== -1) {
      _.each(newLiveGames, function(game) {
        var gameName = game.homeTeamAbbrv + ' - ' + game.awayTeamAbbrv;
        var message = 'Peli alkoi!';
        var gameLink = 'http://floorball.fi/tulokset/#/ottelu/live/' + game.game + '/' + process.env['FLOORBALL_GROUP_ID'];
        console.log(gameName + ': ' + message);
        pushover.send({
          title: gameName,
          message: message,
          sound: 'bike',
          url: gameLink,
        });
      });
    }

    var endedGames = _.filter(prevLiveGameIDs, function(gameID) { return !_.contains(liveGameIDs, gameID) });
    if(endedGames.length) { 
      _.each(endedGames, function(gameID) {
        return false; // disabled game endings for now, since period breaks are already reported on
        var gameURI = '/game/' + gameID + '/' + process.env['FLOORBALL_GROUP_ID'];
        floorball.get(gameURI).on('complete', function(game) {
          var gameID = game.meta.gameID;
          var gameName = game.meta.homeTeam + ' - ' + game.meta.awayTeam;
          var score = game.meta.homeGoalTotal + '-' + game.meta.awayGoalTotal;
          var message = 'Peli päättyi tilanteeseen ' + score;
          var gameLink = 'http://floorball.fi/tulokset/#/ottelu/live/' + gameID + '/' + process.env['FLOORBALL_GROUP_ID'];
          console.log(gameName + ': ' + message);
          pushover.send({
            title: gameName,
            message: message,
            sound: 'bike',
            url: gameLink,
          });
        });
      });
    }

    //console.log("LIVE games:");
    console.log(liveGameIDs);

  });

};

var updateGames = function(game, callback) {

  var gameURI = '/game/' + game.game + '/' + process.env['FLOORBALL_GROUP_ID'];
  floorball.get(gameURI).on('complete', function(game) {

    var gameID = game.meta.gameID;
    var gameName = game.meta.homeTeam + ' - ' + game.meta.awayTeam;
    var currGameTime = game.meta.gameEffTime;
    var prevGameTime = gameTimes[gameID] || -1;
    var prevGameEvents = gameEvents[gameID] || -1;
    var gameLink = 'http://floorball.fi/tulokset/#/ottelu/live/' + gameID + '/' + process.env['FLOORBALL_GROUP_ID'];

    // detect period starts by checking when the gameTime rolls over period breaks
    _.each(game.meta.periods, function (period) {
      if(prevGameTime != -1 && currGameTime > period.startTime && prevGameTime <= period.startTime) {
        // period has just started !
        var message = period.periodNumber + '. erä alkoi!';

        console.log(gameName + ': ' + message);
        pushover.send({
          title: gameName,
          message: message,
          sound: 'bike',
          url: gameLink,
        });
      }
    });

    // generate a new unique ID for each event based on the event time and id
    _.each(game.events, function (event) {
      event.uniqueID = event.gameTime + '-' + event.eventID;
    });

    var newEvents = _.filter(game.events, function(event) { return !_.contains(prevGameEvents, event.uniqueID) });

    _.forEachRight(newEvents, function(event) {

      if(prevGameEvents === -1) return false;

      //console.log('Event #' + event.eventID);
      switch(event.appEventType) {

        case 'goal':
          var team = event.teamAbbrv;
          var scorer = event.scorerLastName != 'OMA MAALI' ? event.scorerFirstName + ' ' + event.scorerLastName : 'OMA MAALI';
          var score = event.homeGoals + '-' + event.awayGoals;
          var message = score + '! Maalintekijä: ' + scorer;

          // assisting
          if(event.ass1ID) {
            message += ', syöttäjä: ' + event.ass1FirstName + ' ' + event.ass1LastName;
          }

          console.log(gameName + ': ' + message);
          pushover.send({
            title: gameName,
            message: message,
            sound: 'bike',
            url: gameLink,
          });
          break;

        case 'periodBreak':
          var score = game.meta.homeGoalTotal + '-' + game.meta.awayGoalTotal;
          /*if(game.meta.homeGoalTotal != game.meta.awayGoalTotal) {
            score += ' for ';
            score += game.meta.homeGoalTotal > game.meta.awayGoalTotal ? game.meta.homeTeam : game.meta.awayTeam;
          }*/
          var message = event.period + '. erä päättyi. Lopputulos: ' + score;
          console.log(gameName + ': ' + message);
          pushover.send({
            title: gameName,
            message: message,
            sound: 'bike',
            url: gameLink,
          });

          break;

        case 'penalty':
          var sufferer = event.suffererFirstName + ' ' + event.suffererLastName;
          var message = event.penaltyMinutes + ' min ' + event.teamAbbrv + ', ' + sufferer + ', ' + event.penaltyFaultName;
          // 2 min Sheriffs, ANU NUMMELIN, TYÖNTÄMINEN
          console.log(gameName + ': ' + message);
          pushover.send({
            title: gameName,
            message: message,
            sound: 'bike',
            url: gameLink,
          });
          break;

        case 'timeout':
          // Aikalisä, ÅIF
          var message = "Aikalisä, " + event.teamAbbrv;
          console.log(gameName + ': ' + message);
          pushover.send({
            title: gameName,
            message: message,
            sound: 'bike',
            url: gameLink,
          });
          break;

        default:
          console.log(gameName + ': ' + 'Unknown event: ' + event.type);
          break;
      }
    });

    gameTimes[gameID] = currGameTime;
    gameEvents[gameID] = _.map(game.events, function(event) { return event.uniqueID; });

    callback();
  });
};

// entry point
var start = function() {

  var message =  'Floorball.fi LIVE tracker botti on juuri käynnistetty.';
  console.log(message);
  pushover.send({
    title: 'Info',
    message: message,
    sound: 'bike',
  });

  // main loop
  setInterval(mainLoop, process.env['FLOORBALL_INTERVAL']);
  mainLoop();

};

// Automatically call the main function if we're the main module
if (require.main === module) {
  start();
}
