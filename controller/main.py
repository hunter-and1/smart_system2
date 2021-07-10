# -*- encoding: utf-8 -*-
##############################################################################
#    Copyright (c) 2012 - Present Acespritech Solutions Pvt. Ltd. All Rights Reserved
#    Author: <info@acespritech.com>
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#
#    A copy of the GNU General Public License is available at:
#    <http://www.gnu.org/licenses/gpl.html>.
#
##############################################################################

import odoo
from odoo import http, SUPERUSER_ID, _
from odoo.http import request
from odoo.addons.web.controllers.main import Home, ensure_db

class Home(Home):
    @http.route('/web/login', type='http', auth="none")
    def web_login(self, redirect=None, **kw):
        ensure_db()
        request.params['login_success'] = False
        if request.httprequest.method == 'GET' and redirect and request.session.uid:
            return http.redirect_with_hash(redirect)
        if not request.uid:
            request.uid = odoo.SUPERUSER_ID
        values = request.params.copy()
        try:
            values['databases'] = http.db_list()
        except odoo.exceptions.AccessDenied:
            values['databases'] = None
        # if request.httprequest.method == 'POST':
        #     old_uid = request.uid
        #     uid = request.session.authenticate(request.session.db, request.params['login'], request.params['password'])
        #     if uid is not False:
        #         res_user_pos_config = request.env['res.users'].browse(uid)
        #         if res_user_pos_config.default_pos:
        #             try:
        #                 res_user_pos_config.default_pos.open_existing_session_cb_close()
        #                 return http.redirect_with_hash("/pos/web/#action=pos.ui")
        #             except Exception as e:
        #                 request.cr.rollback()
        #                 request.session.logout(keep_db=True)
        #                 request.uid = old_uid
        #                 values['error'] = _(e[0])
        #                 return request.render('web.login', values)
        #         else:
        #             return http.redirect_with_hash(redirect)
        #         request.params['login_success'] = True
        #         if not redirect:
        #             redirect = '/web'
        #         return http.redirect_with_hash(redirect)
        #     request.uid = old_uid
        #     values['error'] = _("Wrong login/password")
        # return request.render('web.login', values)
        if request.httprequest.method == 'POST':
            old_uid = request.uid
            uid = request.session.authenticate(request.session.db, request.params['login'], request.params['password'])
            if uid is not False:
                request.params['login_success'] = True
                if not redirect:
                    redirect = '/web'
                res_user_pos_config = request.env['res.users'].browse(uid)
                if res_user_pos_config.default_pos:
                    try:
                        session = res_user_pos_config.default_pos.open_session_cb()
                        if session:
                            session_obj = request.env['pos.session'].browse(session.get('res_id'))
                            if session_obj:
                                session_obj.action_pos_session_open()
                        # res_user_pos_config.default_pos
                        return http.redirect_with_hash("/pos/web/#action=pos.ui")
                    except Exception as e:
                        request.cr.rollback()
                        request.uid = old_uid
                        values['error'] = _(e[0])
                        return request.render('web.login', values)
                else:
                    return http.redirect_with_hash(redirect)
            request.uid = old_uid
            values['error'] = _("Wrong login/password")
        return request.render('web.login', values)
# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4:
