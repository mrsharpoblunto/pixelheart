import {Router,Route,Link} from 'react-router';
import React from 'react';
import Index from './components/index';
import NoodleShop from './components/noodleshop/scene';

export default <Route name='index' path='/' handler={Index}>
    <Route name='noodleshop' path='/noodleshop' handler={NoodleShop} />
</Route>
