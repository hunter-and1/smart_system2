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
{
    'name': 'Pos Smart System Ar',
    'version': '1.0',
    'category': 'Point of Sale',
    'summary' : "Point of Sale Smart System arab",
    "description": """ Smart System Ar """,
    'author': " Solutions Pvt. Ltd.",
    'website': "pritech",
    'depends': ['web', 'point_of_sale','sale'],
    'data': [
        'security/ir.model.access.csv',
        'data/product.xml',
        'views/wizard_debt_history_views.xml',
        'views/wizard_customers_debts_views.xml',
        'views/wizard_profit_margin_views.xml',
        'views/point_of_sale.xml',
        'views/pos_smart_system.xml',
        'views/pos_debt_report_view.xml',
        'views/res_partner_views.xml',
        'views/report_debt_history_template.xml',
        'views/report_profit_margin_template.xml',
        'views/report_customers_debts_template.xml',
        'views/report_sessionsummary.xml',
        'views/aspl_pos_receipt_report.xml',
        'report.xml'
    ],
    'demo': [],
    'test': [],
    'images': ['static/description/main_screenshot.png'],
    'qweb': ['static/src/xml/pos.xml'],
    'installable': True,
    'auto_install': False,
}
# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4: