import React from 'react';
import Router from 'react-router';
import routes from '../../src/routes';

export default function(id) {
    var router = Router.create({
        routes: routes,
        location: Router.HistoryLocation
    });
    router.run(function(Handler,state) {
        React.render(React.createElement(Handler),document.getElementById(id));
    });
}
