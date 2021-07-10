odoo.define('smart_system2.screens', function (require) {
    "use strict";

    var screens = require('point_of_sale.screens');
    var pos_model = require('point_of_sale.models');
    var Model   = require('web.Model');
    var db = require('point_of_sale.DB');
    var core = require('web.core');
    var gui     = require('point_of_sale.gui');
    var Dialog = require('web.Dialog');
    var QWeb = core.qweb;
    var time = require('web.time');

    var _t = core._t;

    var AddProductButton = screens.ActionButtonWidget.extend({
        template : 'AddProductButton',
        button_click : function() {
            var self = this;
            var selectedOrder = this.pos.get_order();
            self.gui.show_popup('add_product_popup');
        },
    });

    screens.define_action_button({
        'name' : 'add_product_button',
        'widget' : AddProductButton,
        'condition': function(){
            return this.pos.config.enable_add_product;
        },
    });

    var PayFullDebt = screens.ActionButtonWidget.extend({
        template : 'PayFullDebt',
        button_click : function() {
            var self = this;
            self.gui.show_popup('PayDebtPopupWidget');
        },
    });

    screens.define_action_button({
        'name' : 'pay_full_debt',
        'widget' : PayFullDebt,
        'condition': function(){
            return this.pos.config.enable_debit;
        },
    });

    var AddNoteButton = screens.ActionButtonWidget.extend({
        template: 'AddNoteButton',
        button_click: function(){
            var order    = this.pos.get_order();
            var lines    = order.get_orderlines();
            if(lines.length > 0) {
                var selected_line = order.get_selected_orderline();
                if (selected_line) {
                    this.gui.show_popup('add_note_popup');
                }
            } else {
                alert("Please select the product !");
            }
        },
    });

    screens.define_action_button({
        'name': 'addnoteline',
        'widget': AddNoteButton,
        'condition': function(){
            return this.pos.config.enable_product_note;
        },
    });

    screens.ProductCategoriesWidget.include({ 
        renderElement: function(){
            var self = this;
            this._super();
            $('#syncbutton').click(function(){
                var currency_symbol = (self.pos && self.pos.currency) ? self.pos.currency : {symbol:'$', position: 'after', rounding: 0.01, decimals: 2};
                $('#syncbutton').toggleClass('rotate', 'rotate-reset');
                self.pos.load_new_products(currency_symbol)
            });
        },
    });
    
    screens.ProductListWidget.include({
        set_product_list: function(product_list){
            var self = this;
            self.actual_product_list = [];
            var prod_temp = []
            if (self.pos.config.debt_dummy_product_id[0]){
                prod_temp.push(self.pos.config.debt_dummy_product_id[0]);
            }
            if (self.pos.config.paid_amount_product[0]){
                prod_temp.push(self.pos.config.paid_amount_product[0]);
            }
            _.each(product_list, function(product){
                    if (product.id){
                        if ($.inArray(product.id, prod_temp) == -1){
                            self.actual_product_list.push(product);
                        } 
                    }
                });
            this.product_list = self.actual_product_list;
            this.renderElement();
        },
    });

    screens.PaymentScreenWidget.include({
        init: function(parent, options) {
            this._super(parent, options);
            this.pos.on('updateDebtHistory', function(partner_ids){
                this.update_debt_history(partner_ids);
            }, this);
            
        },
        update_debt_history: function (partner_ids){
            var client = this.pos.get_client();
            if (client && $.inArray(client.id, partner_ids) != -1) {
                this.gui.screen_instances.products.actionpad.renderElement();
                this.customer_changed();
            }
        },
        renderElement: function() {
            var self = this;
            this._super();
            var order = this.pos.get_order();
            var $pay_full_debt = this.$('.pay-full-debt');
            $pay_full_debt.on('click', function() {
                self.pay_full_debt();
            });
            this.$('.create_draft').click(function(){
                order.set_draft_order(true);
                self.validate_order();
	        });
        },
        show: function() {
            self = this;
            this._super();
            $("textarea#order_note").focus(function() {
                window.document.body.removeEventListener('keypress',self.keyboard_handler);
                window.document.body.removeEventListener('keydown',self.keyboard_keydown_handler);
            });
            $("textarea#order_note").focusout(function() {
                window.document.body.addEventListener('keypress',self.keyboard_handler);
                window.document.body.addEventListener('keydown',self.keyboard_keydown_handler);
            });
        },
        finalize_validation: function() {
            var self = this;
            var order = this.pos.get_order();

            if (order.is_paid_with_cash() && this.pos.config.iface_cashdrawer) {
                this.pos.proxy.open_cashbox();
            }

            order.initialize_validation_date();

            if (order.is_to_invoice()) {
                var invoiced = this.pos.push_and_invoice_order(order);
                this.invoicing = true;

                invoiced.fail(function(error){
                    self.invoicing = false;
                    if (error.message === 'Missing Customer') {
                        self.gui.show_popup('confirm',{
                            'title': _t('Please select the Customer'),
                            'body': _t('You need to select the customer before you can invoice an order.'),
                            confirm: function(){
                                self.gui.show_screen('clientlist');
                            },
                        });
                    } else if (error.code < 0) {        // XmlHttpRequest Errors
                        self.gui.show_popup('error',{
                            'title': _t('The order could not be sent'),
                            'body': _t('Check your internet connection and try again.'),
                        });
                    } else if (error.code === 200) {    // OpenERP Server Errors
                        self.gui.show_popup('error-traceback',{
                            'title': error.data.message || _t("Server Error"),
                            'body': error.data.debug || _t('The server encountered an error while receiving your order.'),
                        });
                    } else {                            // ???
                        self.gui.show_popup('error',{
                            'title': _t("Unknown Error"),
                            'body':  _t("The order could not be sent to the server due to an unknown error"),
                        });
                    }
                });

                invoiced.done(function(){
                    self.invoicing = false;
                    self.gui.show_screen('receipt');
                });
            } else {
                this.pos.push_order(order).then(function(){
                    self.gui.show_screen('receipt');
                });
            }
        },
        validate_order: function(force_validation) {
            var self = this;
            var order = self.pos.get_order();
            if (this.pos.config.enable_multi_sale_location){
                var lines =  order.get_orderlines();
                var line_data = [];
                var diff_location = [];
                var dict_current_location ={};
                _.each(lines, function(line){
                    if (line.get_stock_location()){
                        if(line.get_stock_location()[0] != self.pos.config.stock_location_id[0]){
                            diff_location.indexOf(line.get_stock_location()[0]) === -1 ?
                            diff_location.push(line.get_stock_location()[0]) : console.log("");
                        }
                    }
                });
                for (var stock=0;stock<diff_location.length;stock++){
                    var line_list = []
                    for (var line=0;line<lines.length;line++){
                        if (lines[line].get_stock_location()[0] == diff_location[stock]){
                             line_list.push(lines[line])
                        }
                    }
                    dict_current_location[diff_location[stock]] = line_list; 

                }
                order.set_order_stock_location(dict_current_location); 
            }
            if(this.pos.config.enable_order_note) {
                var currentOrder = this.pos.get_order();
                currentOrder.set_order_note($('#order_note').val());
            }
            // debt_notebook Module
            var currentOrder = this.pos.get_order();
            var isDebt = currentOrder.updates_debt();
            var debt_amount = currentOrder.get_debt_delta();
            var client = currentOrder.get_client();
            if(self.pos.config.enable_debit){
                if (client){
                    currentOrder.debt_before = client.debt;
                    currentOrder.debt_after = currentOrder.debt_before + debt_amount;
                } else {
                    currentOrder.debt_before = false;
                    currentOrder.debt_after = false;
                }
                if (isDebt && !client){
                    this.gui.show_popup('error',{
                        'title': _t('Unknown customer'),
                        'body': _t('You cannot use Debt payment. Select customer first.'),
                    });
                    return;
                }
                if (currentOrder.has_credit_product() && !client){
                    this.gui.show_popup('error',{
                        'title': _t('Unknown customer'),
                        'body': _t("Don't forget to specify Customer when sell Credits."),
                    });
                    return;
                }
                if(isDebt && currentOrder.get_orderlines().length === 0){
                    this.gui.show_popup('error',{
                        'title': _t('Empty Order'),
                        'body': _t('There must be at least one product in your order before it can be validated. (Hint: you can use some dummy zero price product)'),
                    });
                    return;
                }
                if (client && debt_amount > 0 && client.debt + debt_amount > client.debt_limit) {
                    this.gui.show_popup('error', {
                        'title': _t('Max Debt exceeded'),
                        'body': _t('You cannot sell products on credit to the customer, because his max debt value will be exceeded.')
                    });
                    return;
                }
                client && this.pos.gui.screen_instances.clientlist.partner_cache.clear_node(client.id);
            }
            this._super(force_validation);
        },
        pay_full_debt: function(){
            var order = this.pos.get_order();
            var self = this;
            if (self.pos.config.enable_debit){
                var debtjournal = false;
                _.each(this.pos.cashregisters, function(cashregister) {
                    if (cashregister.journal.debt) {
                        debtjournal = cashregister;
                    }

                });

                var paymentLines = order.get_paymentlines();
                if (paymentLines.length) {
                    _.each(paymentLines, function(paymentLine) {
                        if (paymentLine.cashregister.journal.debt){
                            paymentLine.destroy();
                        }
                    });
                }
                var order = self.pos.get_order();
                var product = self.pos.db.get_product_by_id(self.pos.config.debt_dummy_product_id[0]);
                order.add_product(product);
                var newDebtPaymentline = new pos_model.Paymentline({},{order: order, cashregister: debtjournal, pos: this.pos});
                newDebtPaymentline.set_amount(order.get_client().debt * -1);
                order.paymentlines.add(newDebtPaymentline);
                this.render_paymentlines();
            }
        },
        pay_partial_debt: function(amount){
            var order = this.pos.get_order();
            var self = this;
            if (self.pos.config.enable_debit){
                var debtjournal = false;
                _.each(this.pos.cashregisters, function(cashregister) {
                    if (cashregister.journal.debt) {
                        debtjournal = cashregister;
                    }

                });

                var paymentLines = order.get_paymentlines();
                if (paymentLines.length) {
                    _.each(paymentLines, function(paymentLine) {
                        if (paymentLine.cashregister.journal.debt){
                            paymentLine.destroy();
                        }
                    });
                }
                var order = self.pos.get_order();
                var product = self.pos.db.get_product_by_id(self.pos.config.debt_dummy_product_id[0]);
                order.add_product(product);
                var newDebtPaymentline = new pos_model.Paymentline({},{order: order, cashregister: debtjournal, pos: this.pos});
                newDebtPaymentline.set_amount(amount * -1);
                order.paymentlines.add(newDebtPaymentline);
                this.render_paymentlines();
            }
        },
        is_paid: function(){
            var currentOrder = this.pos.get_order();
            return (currentOrder.getPaidTotal() + 0.000001 >= currentOrder.getTotalTaxIncluded());
        },
        customer_changed: function() {
            var self = this;
            if (self.pos.config.enable_debit){
                var client = this.pos.get_client();
                var debt = 0;
                if (client) {
                    debt = Math.round(client.debt * 100) / 100;
                    if (client.debt_type == 'credit') {
                        debt = - debt;
                    }
                }
                var $js_customer_name = this.$('.js_customer_name');
                var $pay_full_debt = this.$('.pay-full-debt');
                $js_customer_name.text(client ? client.name : _t('Customer'));
                $pay_full_debt.addClass('oe_hidden');
                if (client && debt) {
                    if (client.debt_type == 'debt') {
                        if (debt > 0) {
                            $pay_full_debt.removeClass('oe_hidden');
                            $js_customer_name.append('<span class="client-debt positive"> [Debt: ' + debt + ']</span>');
                        } else if (debt < 0) {
                            $js_customer_name.append('<span class="client-debt negative"> [Debt: ' + debt + ']</span>');
                        }
                    } else if (client.debt_type == 'credit') {
                        if (debt > 0) {
                            $js_customer_name.append('<span class="client-credit positive"> [Credit: ' + debt + ']</span>');
                        } else if (debt < 0) {
                            $pay_full_debt.removeClass('oe_hidden');
                            $js_customer_name.append('<span class="client-credit negative"> [Credit: ' + debt + ']</span>');
                        }
                    }
                }
            }
        },
        click_delete_paymentline: function(cid){
            var self = this;
            var lines = this.pos.get_order().get_paymentlines();
            for ( var i = 0; i < lines.length; i++ ) {
                if (lines[i].cid === cid) {
                    if(lines[i] && lines[i].get_dummy_line()){
                        return
                    }
                }
            }
            this._super(cid);
        },
    });

    screens.OrderWidget.include({

        click_line: function(orderline, event) {
            if (event.target.id == 'stock_location'){
                this.gui.show_popup('stock_loction_popup');
            }
            this.pos.get_order().select_orderline(orderline);
            this.numpad_state.reset();
        },
        set_value: function(val) {
            var self = this;
            var order = this.pos.get_order();
            if (order.get_selected_orderline()) {
                var mode = this.numpad_state.get('mode');
                if( mode === 'quantity'){
                	var partner = order.get_client();
                	var pricelist_id = order.get_pricelist();
                    if (pricelist_id && order.get_selected_orderline() && (val != 'remove')) {
    //                	var pricelist_id = partner.property_product_pricelist[0];
                        var qty = order.get_selected_orderline().get_quantity();
                        var p_id = order.get_selected_orderline().get_product().id;
                        if (! val) {
                            val = 1;
                        }
                        new Model("product.pricelist").get_func('price_get')([pricelist_id], p_id, parseInt(val)).pipe(
                            function(res){
                                if (res[pricelist_id]) {
                                    var pricelist_value = parseFloat(res[pricelist_id].toFixed(2));
                                    if (pricelist_value) {
                                    	order.get_selected_orderline().set_quantity(val);
                                        order.get_selected_orderline().set_unit_price(pricelist_value);
                                    }
                                }
                            }
                        );
                    } else {
                    	order.get_selected_orderline().set_quantity(val);
                    }
//                    if (val=="" && order.get_selected_orderline()){
//                        if (order.get_selected_orderline().quantity == 0){
//                            order.get_selected_orderline().set_line_margin(0);
//                        }
//                    } else if (val && order.get_selected_orderline()){
//                        if (order.get_selected_orderline().quantity == 0){
//                            order.get_selected_orderline().set_line_margin(0);
//                        }else{
//                            if (order.get_selected_orderline().get_quantity() >= 1){
//                                var total = order.get_selected_orderline().get_display_price() - (order.get_selected_orderline().product.standard_price * order.get_selected_orderline().get_quantity());
//                                order.get_selected_orderline().set_line_margin(total);
//                            } else{
//                                var total = order.get_selected_orderline().get_display_price() - (order.get_selected_orderline().product.standard_price );
//                                order.get_selected_orderline().set_line_margin(total);
//                            }
//                        }
//                    }
                }else if( mode === 'discount'){
                    order.get_selected_orderline().set_discount(val);
//                    if(self.pos.config.enable_margin){
//                        if (val=="" && order.get_selected_orderline()){
//                            if (order.get_selected_orderline().get_quantity() >= 1){
//                                var total = order.get_selected_orderline().get_display_price() - (order.get_selected_orderline().product.standard_price * order.get_selected_orderline().get_quantity());
//                                order.get_selected_orderline().set_line_margin(total);
//                            } else{
//                                var total = order.get_selected_orderline().get_display_price() - (order.get_selected_orderline().product.standard_price );
//                                order.get_selected_orderline().set_line_margin(total);
//                            }
//                        } else if (val && order.get_selected_orderline()){
//                            if (order.get_selected_orderline().get_discount() >= 100){
//                                order.get_selected_orderline().set_line_margin(0);
//                            } else{
//                                if (order.get_selected_orderline().get_quantity() >= 1){
//                                var total = order.get_selected_orderline().get_display_price() - (order.get_selected_orderline().product.standard_price * order.get_selected_orderline().get_quantity());
//                                order.get_selected_orderline().set_line_margin(total);
//                                } else{
//                                    var total = order.get_selected_orderline().get_display_price() - (order.get_selected_orderline().product.standard_price );
//                                    order.get_selected_orderline().set_line_margin(total);
//                                }
//                            }
//                        }
//                    }
//                    var disc = order.get_selected_orderline().get_unit_price() * order.get_selected_orderline().get_discount() / 100 ;
//                    var price =  order.get_selected_orderline().get_unit_price() - disc;
//                    if (order.get_selected_orderline().get_display_price() < order.get_selected_orderline().product.standard_price * order.get_selected_orderline().get_quantity()){
//                        self.pos.db.notification('info','Sale price is less then cost price!');
//                         $('.pos .order .orderline.selected').css("background","#F57D7D");
//                    }
                }else if( mode === 'price'){
                    order.get_selected_orderline().set_unit_price(val);
//                    if(self.pos.config.enable_margin){
//                        if (val=="" && order.get_selected_orderline()){
//                            if (order.get_selected_orderline().get_unit_price() == 0){
//                                order.get_selected_orderline().set_line_margin(0);
//                            }
//                        } else if (val && order.get_selected_orderline()){
//                            if (order.get_selected_orderline().get_unit_price() == 0){
//                                order.get_selected_orderline().set_line_margin(0);
//                            } else{
//                                if (order.get_selected_orderline().get_quantity() >= 1){
//                                var total = order.get_selected_orderline().get_display_price() - (order.get_selected_orderline().product.standard_price * order.get_selected_orderline().get_quantity());
//                                order.get_selected_orderline().set_line_margin(total);
//                                } else{
//                                    var total = order.get_selected_orderline().get_display_price() - (order.get_selected_orderline().product.standard_price );
//                                    order.get_selected_orderline().set_line_margin(total);
//                                }
//                            }
//                        }
//                    }
//                    if (order.get_selected_orderline().get_unit_price() < order.get_selected_orderline().product.standard_price){
//                        self.pos.db.notification('info','Sale price is less then cost price!');
//                         $('.pos .order .orderline.selected').css("background","#F57D7D");
//                    }
                }
            }
        },
        update_summary: function(){
            var self = this;
			self._super();
			var order = this.pos.get_order();
			if (!order.get_orderlines().length) {
			    return;
			}
			if(self.pos.config.enable_cart_detail){
				var total_qty = 0.00;
	            var no_items = 0.00;
	            var orderline_quantity = order.get_orderlines();
	            no_items = orderline_quantity.length;
	            _.each(orderline_quantity, function(select_quantity){
	                    total_qty += select_quantity.quantity;
	            });
	            order.set_total_qty(total_qty);
	            var total_quantity  = order.get_total_qty();
	            this.el.querySelector('.summary .total .total_qty .value').textContent = total_quantity;
	            this.el.querySelector('.summary .total .no_items .value').textContent = no_items;
	        }
	        if(self.pos.config.enable_margin){
				var margin = order ? order.get_total_margin() : 0;
				this.el.querySelector('.summary .total .margin .value').textContent = this.format_currency(margin);
			}
			if(self.pos.config.enable_show_cost_price && order.get_selected_orderline()){
			    var selected_line = order.get_selected_orderline();
			    if (selected_line.get_discount()){
			        var total_cost_price = selected_line.get_product().standard_price * selected_line.get_quantity();
                    if (selected_line.get_display_price() < total_cost_price){
                        self.pos.db.notification('info','Sale price is less then cost price!');
                        $('.pos .order .orderline.selected').css("background","#F57D7D");
                    }
			    } else {
			        if (selected_line.get_unit_price() < selected_line.get_product().standard_price){
                        self.pos.db.notification('info','Sale price is less then cost price!');
                        $('.pos .order .orderline.selected').css("background","#F57D7D");
                    }
			    }
			}
        },
        render_orderline: function(orderline){
            var el_str  = QWeb.render('Orderline',{widget:this, line:orderline});
            var el_node = document.createElement('tbody');
                el_node.innerHTML = _.str.trim(el_str);
                el_node = el_node.childNodes[0];
                el_node.orderline = orderline;
                el_node.addEventListener('click',this.line_click_handler);
            var el_lot_icon = el_node.querySelector('.line-lot-icon');
            if(el_lot_icon){
                el_lot_icon.addEventListener('click', (function() {
                    this.show_product_lot(orderline);
                }.bind(this)));
            }

            orderline.node = el_node;
            return el_node;
        },
        renderElement: function(scrollbottom){
        	this._super(scrollbottom);
        	var order_container_width = $('.order-container').width();
    		var order_container_height = $('.order-container').height();
        	$('.order-container').resizable();
            $('.order-container').mousedown(function() {
            	$('.order-container').css('z-index','1000');
            	$('.order-container').css('border', '4px solid #6d6b6b');
            	$('.order').css('max-width','100%');
            });
        },
    });
	
	screens.ProductScreenWidget.include({
    	start: function(){ 
    		var self = this;
    		this._super();
            var pricelist_list = this.pos.prod_pricelists;
            var new_options = [];
            new_options.push('<option value="">Select Pricelist</option>\n');
            if(pricelist_list.length > 0){
                for(var i = 0, len = pricelist_list.length; i < len; i++){
                    new_options.push('<option value="' + pricelist_list[i].id + '">' + pricelist_list[i].display_name + '</option>\n');
                }
                $('#price_list').html(new_options);
                var order = self.pos.get('selectedOrder');
                if(order.get_client() && order.get_client().property_product_pricelist[0]){
                	$('#price_list').val(order.get_client().property_product_pricelist[0]);
                }
                $('#price_list').selectedIndex = 0;
            }
            $('#price_list').on('change', function() {
                var partner_id = self.pos.get('selectedOrder').get_client() && parseInt(self.pos.get('selectedOrder').get_client().id);
                if (!partner_id) {
                	$('#price_list').html(new_options);
                    alert('Pricelist will not work as customer is not selected !');
                    return;
                }
            });
    	},
    });

    screens.ActionpadWidget.include({
        renderElement: function() {
            var self = this;
            var debtjournal = false;
            this._super();
            _.each(self.pos.cashregisters, function(cashregister) {
                if (cashregister.journal.debt) {
                    debtjournal = cashregister.journal_id[0];
                }
            });
            var currentOrder = self.pos.get_order();
            if (self.pos.config.enable_debit){
                this.$('.pay').unbind('click').click(function(){
                    var order = self.pos.get_order();
                    var has_valid_product_lot = _.every(order.orderlines.models, function(line){
                        return line.has_valid_product_lot();
                    });
                    if(!has_valid_product_lot){
                        self.gui.show_popup('confirm',{
                            'title': _t('Empty Serial/Lot Number'),
                            'body':  _t('One or more product(s) required serial/lot number.'),
                            confirm: function(){
                                self.gui.show_screen('payment');
                            },
                        });
                    }else{
                        self.gui.show_screen('payment');
                    }
                    self.$('.set-customer').click(function(){
                        self.gui.show_screen('clientlist');
                    });
                    if (order.get_orderlines().length> 0 && debtjournal && !order.get_edit_pos_order()){
                        self.pos.gui.screen_instances.payment.click_paymentmethods(debtjournal);
                        if(order.selected_paymentline){
                            order.selected_paymentline.set_amount( Math.max(order.get_total_with_tax(),0) );
                        }
                        
                    }
                });
            }
        },
    });

    screens.ClientListScreenWidget.include({
    	save_changes: function(){
    		this._super();
            if( this.has_client_changed()){
            	if(this.new_client){
            		this.pos.get_order().set_pricelist_val(this.new_client.id);
            	} else {
            		$('#price_list').val('');
            	}
            }
        },
    });

    screens.ReceiptScreenWidget.include({
        renderElement: function(){
            var self = this;
            this._super();
            this.$('.button.print_pdf').click(function(){
                if (!self._locked) {
                    // generate the pdf and download it
                    if(self.pos.order_to_print){
                    	self.chrome.do_action('smart_system2.report_pos_receipt', {additional_context:{
                            active_ids:[self.pos.order_to_print],
                        }});
                    }
                }
            });
        },
        render_receipt: function() {
            this._super();
            var order = this.pos.get_order();
            var print_locations = order.get_order_stock_location();
            if (print_locations){
                for (var key in print_locations) {
                        this.$('.pos-receipt-container').append(QWeb.render('store_location_receipt',{
                        widget:this,
                        data:print_locations[key],
                        order: order,
                        receipt: order.export_for_printing(),
                    }));    
                }
            }
        },
        print_xml: function() {
            var self = this;
            var order = this.pos.get_order();
            this._super();
            if (this.pos.config.enable_multi_sale_location){
                var print_locations = order.get_order_stock_location();
                if (print_locations){
                    for (var key in print_locations) {
                        var param = {
                            widget:this,
                            data:print_locations[key],
                            order: order,
                            receipt: order.export_for_printing(),
                        }
                        var store_location_receipt = QWeb.render('xml_store_location_receipt', param);
                        self.pos.proxy.print_receipt(store_location_receipt);
//                        self.dialog = new Dialog(this, {
//                            title: 'Testing receipt',
//                            $content: store_location_receipt,
//                        }).open();
                    }
                }
            }
        },
    });
    /* Order List */
    var ShowOrderList = screens.ActionButtonWidget.extend({
	    template : 'ShowOrderList',
	    button_click : function() {
	        self = this;
	        self.gui.show_screen('orderlist');
	    },
	});

	screens.define_action_button({
	    'name' : 'showorderlist',
	    'widget' : ShowOrderList,
        'condition': function(){
            return this.pos.config.enable_order_list;
        },
	});

    /* Order list screen */
	var OrderListScreenWidget = screens.ScreenWidget.extend({
	    template: 'OrderListScreenWidget',

	    init: function(parent, options){
	    	var self = this;
	        this._super(parent, options);
	        this.reload_btn = function(){
	        	$('.fa-refresh').toggleClass('rotate', 'rotate-reset');
	        	self.reloading_orders();
	        };
	    },

	    filter:"all",

        date: "all",

	    start: function(){
	    	var self = this;
            this._super();

            this.$('.back').click(function(){
                self.gui.back();
            });

            var orders = self.pos.get('pos_order_list');
            this.render_list(orders);

            this.$('input#datepicker').bind('keypress change',function(e){
            	var regEx = /^\d{4}-\d{2}-\d{2}$/;
            	var enter = e.which;
            	if(enter == 13){
            		var temp = self.$('#datepicker').val();
	            	if(temp === ""){
	            		self.date = "all"
	            	}else if(jQuery.type(new Date(temp)) == "date" && temp.match(regEx) !== null){
	            		self.date = temp;
	            	}else{
	            		self.$('#datepicker').focusout();
	            		alert("please input a valid date..");

	            	}
	            	self.render_list(orders);
            	}
            	else if(e.which == 8 || e.which == 46){
            		if($(this).val() == ""){
            			self.date = "all";
            			self.render_list(orders);
            		}
            	}
            });
            this.$('#select_all_orders').click(function(){
                var orders = self.pos.get('pos_order_list');
                _.each(orders, function(order){
                    if(order.state === "draft"){
                        var checkbox = $('.order-list-contents').find('td #select_order[data-id="'+ order.id +'"]');
                        checkbox.prop('checked', !checkbox.prop('checked'));
                    }
                })
            });
            this.$('.button.validate').click(function(){
                var to_be_validate = []
                _.each($('.order-list-contents tr'), function(order_lines){
                    if($(order_lines).find('#select_order').prop('checked')){

                        var order = self.pos.db.get_order_by_id($(order_lines).find('#select_order').data('id'));
                        if(order.state === "draft"){
                            var statement_id = false;
                            if(order.statement_ids.length <= 0){
                                statement_id = _.find(self.pos.cashregisters, function(o){
                                    return o.journal.type === 'cash'
                                });
                            }
                            to_be_validate.push({
                                'order_id': order.id,
                                'amount_total': order.amount_total - order.amount_paid,
                                'statement_id': order.statement_ids[0] | statement_id.id,
                                'name': time.datetime_to_str(new Date()),
                            });

                        }

                    }
                });
                new Model('pos.order').get_func('make_it_paid')(to_be_validate)
            });
          //button draft
            this.$('.button.draft').click(function(){
            	var orders=self.pos.get('pos_order_list');
            	if(self.$(this).hasClass('selected')){
	        		self.$(this).removeClass('selected');
	        		self.filter = "all";
        		}else{
        			if(self.$('.button.paid').hasClass('selected')){
            			self.$('.button.paid').removeClass('selected');
            		}
        			if(self.$('.button.posted').hasClass('selected')){
            			self.$('.button.posted').removeClass('selected');
            		}
        			self.$(this).addClass('selected');
	        		self.filter = "draft";
        		}
        		self.render_list(orders);
            });

            //button paid
        	this.$('.button.paid').click(function(){
        		var orders=self.pos.get('pos_order_list');
        		if(self.$(this).hasClass('selected')){
	        		self.$(this).removeClass('selected');
	        		self.filter = "all";
        		}else{
        			if(self.$('.button.draft').hasClass('selected')){
            			self.$('.button.draft').removeClass('selected');
            		}
        			if(self.$('.button.posted').hasClass('selected')){
            			self.$('.button.posted').removeClass('selected');
            		}
        			self.$(this).addClass('selected');
	        		self.filter = "paid";
        		}
        		self.render_list(orders);
            });
        	 //button posted
            this.$('.button.posted').click(function(){
            	var orders=self.pos.get('pos_order_list');
            	if(self.$(this).hasClass('selected')){
	        		self.$(this).removeClass('selected');
	        		self.filter = "all";
        		}else{
        			if(self.$('.button.paid').hasClass('selected')){
            			self.$('.button.paid').removeClass('selected');
            		}
        			if(self.$('.button.draft').hasClass('selected')){
            			self.$('.button.draft').removeClass('selected');
            		}
        			self.$(this).addClass('selected');
	        		self.filter = "done";
        		}
        		self.render_list(orders);
            });

            //print order btn
            var selectedOrder;
            this.$('.order-list-contents').delegate('#print_order','click',function(event){
            	var order_id = parseInt($(this).data('id'));
            	self.pos.order_to_print = order_id;
                var result = self.pos.db.get_order_by_id(order_id);
                selectedOrder = self.pos.get_order();
                var currentOrderLines = selectedOrder.get_orderlines();
                if(currentOrderLines.length > 0) {
                	selectedOrder.set_order_id('');
                    for (var i=0; i <= currentOrderLines.length + 1; i++) {
                    	_.each(currentOrderLines,function(item) {
                            selectedOrder.remove_orderline(item);
                        });
                    }
                    selectedOrder.set_client(null);
                }
                selectedOrder = self.pos.get('selectedOrder');
                if (result && result.lines.length > 0) {
                    partner = null;
                    if (result.partner_id && result.partner_id[0]) {
                        var partner = self.pos.db.get_partner_by_id(result.partner_id[0])
                    }
                    selectedOrder.set_amount_paid(result.amount_paid);
                    selectedOrder.set_amount_return(Math.abs(result.amount_return));
                    selectedOrder.set_amount_tax(result.amount_tax);
                    selectedOrder.set_amount_total(result.amount_total);
                    selectedOrder.set_company_id(result.company_id[1]);
                    selectedOrder.set_date_order(result.date_order);
                    selectedOrder.set_client(partner);
                    selectedOrder.set_pos_reference(result.pos_reference);
                    selectedOrder.set_user_name(result.user_id && result.user_id[1]);
                    selectedOrder.set_date_order(result.date_order);
                    selectedOrder.set_order_note(result.note);

                    var statement_ids = [];
                    if (result.statement_ids.length > 0) {
                    	new Model('account.bank.statement.line').get_func('search_read')
                    	([['id', 'in', result.statement_ids]],[])
                    	.then(function(st_result){
                    		_.each(st_result, function(st_res){
                    			var pymnt = {};
                    			if (st_res.amount > 0){
                    				pymnt['amount']= st_res.amount;
                    				pymnt['journal']= st_res.journal_id[1];
                    				statement_ids.push(pymnt);
                    			}
                    		});
                    	});
                        selectedOrder.set_journal(statement_ids);
                    }
                    var count = 0;
                        new Model("pos.order.line").get_func("search_read")([['id', 'in', result.lines]], []).then(
                            function(order_lines) {
                                if (order_lines) {
                                	_.each(order_lines, function(res){
                                        count += 1;
                                        var product = self.pos.db.get_product_by_id(Number(res.product_id[0]));
                                        var line = new pos_model.Orderline({}, {pos: self.pos, order: selectedOrder, product: product});
                                        line.set_discount(res.discount);
                                        line.set_quantity(res.qty);
                                        line.set_unit_price(res.price_unit);
                                        line.set_stock_location(res.line_stock_location);
                                        line.set_line_note(res.line_note);
                                        line.set_line_margin(res.line_margin);
                                        selectedOrder.add_orderline(line);
                                        if (count == (result.lines).length) {
                                        	if(self.pos.config.iface_print_via_proxy){
                                                var receipt = selectedOrder.export_for_printing();
                                                self.pos.proxy.print_receipt(QWeb.render('XmlReceipt',{
                                                    receipt: receipt, widget: self,
                                                }));

                                                self.pos.get('selectedOrder').destroy();    //finish order and go back to scan screen
                                            }else{
                                            	self.gui.show_screen('receipt');
                                            }

                                        }
                                	});
                                }
                            });
                    selectedOrder.set_order_id(order_id);
                }
            });

          //reorder btn
            this.$('.order-list-contents').delegate('#re_order','click',function(event){
            	var order_id = parseInt($(this).data('id'));
                var result = self.pos.db.get_order_by_id(order_id);
                if(result.state == "paid"){
                	alert("Sorry, This order is paid State");
                	return
                }
                if(result.state == "done"){
                	alert("Sorry, This Order is Done State");
                	return
                }
                selectedOrder = self.pos.get_order();
                if (result && result.lines.length > 0) {
               	 	var count = 0;
               	 	var currentOrderLines = selectedOrder.get_orderlines();
               	 	if(currentOrderLines.length > 0) {
	                 	selectedOrder.set_order_id('');
	                    for (var i=0; i <= currentOrderLines.length + 1; i++) {
							_.each(currentOrderLines,function(item) {
								selectedOrder.remove_orderline(item);
							});
	                    }
               	 	}
	               	 var partner = null;
	                 if (result.partner_id && result.partner_id[0]) {
	                     var partner = self.pos.db.get_partner_by_id(result.partner_id[0])
	                 }
	                selectedOrder.set_client(partner);
               	 	selectedOrder.set_pos_reference(result.pos_reference);
               	 	selectedOrder.set_edit_pos_order(true);
               	 	if (result.statement_ids.length > 0) {
               	 	    new Model('account.bank.statement.line').get_func('search_read')
                    	([['id', 'in', result.statement_ids]],[])
                    	.then(function(st_result){
                            if(st_result){
                                var total_paid = 0.00;
                                var change_journal = _.findWhere(st_result, {is_change: true})
                                var change_amount = change_journal ? change_journal.amount : false;
                                _.each(st_result, function(statement){
                                    total_paid += statement.amount;
                                    if(self.pos && self.pos.cashregisters && !statement.is_change){
                                        var dummy_payment_line = _.find(self.pos.cashregisters, function(cashregister){
                                            return cashregister.journal_id[0] === statement.journal_id[0] && !cashregister.journal.debt
                                        });
                                        if(dummy_payment_line){
                                            var amount = 0.00
                                            if(dummy_payment_line.journal.type == "cash"){
                                                amount = change_amount ? statement.amount + change_amount : statement.amount
                                            } else {
                                                amount = statement.amount
                                            }
                                            self.pos.gui.screen_instances.payment.click_paymentmethods(dummy_payment_line.journal_id[0])
                                            selectedOrder.selected_paymentline.set_amount(amount);
                                        }
                                    }
                                })
                            }
                        });
                    }
                    if (result.lines) {
                         _.each(result.lines, function(line) {
                             new Model("pos.order.line").get_func("search_read")([['id', '=', line]], []).then(
                                 function(res) {
                                     if(res){
                                         var res = res[0];
                                         count += 1;
                                         var product = self.pos.db.get_product_by_id(Number(res.product_id[0]));
                                         if(product){
                                             var line = new pos_model.Orderline({}, {pos: self.pos, order: selectedOrder, product: product});
                                             line.set_discount(res.discount);
                                             line.set_quantity(res.qty);
                                             line.set_unit_price(res.price_unit);
                                             line.set_stock_location(res.line_stock_location);
                                             selectedOrder.add_orderline(line);
                                             selectedOrder.select_orderline(selectedOrder.get_last_orderline());
                                             if (count == (result.lines).length) {
                                                self.gui.show_screen('products');
                                             }
                                         }
                                     }
                                 });

                         });
                         selectedOrder.set_order_id(order_id);
                    }
                    selectedOrder.set_sequence(result.name);
                }
            });

            //product popup btn
            this.$('.order-list-contents').delegate('#products','click',function(event){
            	var order_id = parseInt($(this).data('id'));
                var result = self.pos.db.get_order_by_id(order_id);
                if (result && result.lines.length > 0) {
               	 	var count = 0;
               	 	if(result.lines){
               	 		var product_list = "";
//                   	 _.each(result.lines, function(line) {
                            new Model("pos.order.line").get_func("search_read")([['id', 'in', result.lines]], []).then(
                                function(r) {
                                	_.each(r, function(res){
                                		count += 1;
	                                     product_list += "<tr>" +
	                                     			"<td>"+count+"</td>"+
	                                     			"<td>"+res.display_name+"</td>"+
	                                     			"<td>"+res.qty+"</td>"+
	                                     			"<td>"+res.price_unit.toFixed(2)+"</td>"+
	                                     			"<td>"+res.discount+"%</td>"+
	                                     			"<td>"+res.price_subtotal.toFixed(2)+"</td>"+
	                                     		"</tr>";
	                                     self.gui.show_popup('product_popup',{product_list:product_list,
                            																order_id:order_id,
                            																state:result.state});
                                	});
                                });

//                   	 });
               	 	}
                }
            });

			this.$('.order-list-contents').delegate('#re_order_duplicate','click',function(event){
			    var order_id = parseInt($(this).data('id'));
                var result = self.pos.db.get_order_by_id(order_id);

                selectedOrder = self.pos.get('selectedOrder');
                if (result && result.lines.length > 0) {
               	 	var count = 0;
               	 	var currentOrderLines = selectedOrder.get_orderlines();
               	 	if(currentOrderLines.length > 0) {
	                 	selectedOrder.set_order_id('');
	                    for (var i=0; i <= currentOrderLines.length + 1; i++) {
							_.each(currentOrderLines,function(item) {
								selectedOrder.remove_orderline(item);
							});
	                    }
               	 	}
                    var partner = null;
                    if (result.partner_id && result.partner_id[0]) {
                        var partner = self.pos.db.get_partner_by_id(result.partner_id[0])
                    }
                    selectedOrder.set_client(partner);
//               	 	selectedOrder.set_pos_reference(result.pos_reference);
                    if (result.lines) {
                    	 _.each(result.lines, function(line) {
                             new Model("pos.order.line").get_func("search_read")([['id', '=', line]], []).then(
                                 function(res) {
                                	 if(res){
                                		 var res = res[0];
	                                	 count += 1;
	                                     var product = self.pos.db.get_product_by_id(Number(res.product_id[0]));
	                                     if(product){
		                                     var line = new pos_model.Orderline({}, {pos: self.pos, order: selectedOrder, product: product});
		                                     line.set_discount(res.discount);
		                                     line.set_quantity(res.qty);
		                                     line.set_unit_price(res.price_unit)
		                                     line.set_stock_location(res.line_stock_location);
		                                	 selectedOrder.add_orderline(line);
		                                	 selectedOrder.select_orderline(selectedOrder.get_last_orderline());
		                                	 if (count == (result.lines).length) {
		                                     	self.gui.show_screen('products');
		                                     }
	                                     }
                                	 }
                                 });

                    	 });
//                    	 selectedOrder.set_order_id(order_id);
                    }
//                    selectedOrder.set_sequence(result.name);
                }
			});

          //search box
            var search_timeout = null;
            if(this.pos.config.iface_vkeyboard && self.chrome.widget.keyboard){
            	self.chrome.widget.keyboard.connect(this.$('.searchbox input'));
            }
            this.$('.searchbox input').on('keyup',function(event){
                clearTimeout(search_timeout);
                var query = this.value;
                search_timeout = setTimeout(function(){
                    self.perform_search(query,event.which === 13);
                },70);
            });

            this.$('.searchbox .search-clear').click(function(){
                self.clear_search();
            });

	    },
	    show: function(){
	        this._super();
	        this.reload_orders();
	    },
	    perform_search: function(query, associate_result){
            if(query){
                var orders = this.pos.db.search_order(query);
                if ( associate_result && orders.length === 1){
                    this.gui.back();
                }
                this.render_list(orders);
            }else{
                var orders = self.pos.get('pos_order_list');
                this.render_list(orders);
            }
        },
        clear_search: function(){
            var orders = this.pos.get('pos_order_list');
            this.render_list(orders);
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
        },
	    render_list: function(orders){
        	var self = this;
            var contents = this.$el[0].querySelector('.order-list-contents');
            contents.innerHTML = "";
            var temp = [];
            if(self.filter !== "" && self.filter !== "all"){
	            orders = $.grep(orders,function(order){
	            	return order.state === self.filter;
	            });
            }
            if(self.date !== "" && self.date !== "all"){
            	var x = [];
            	for (var i=0; i<orders.length;i++){
                    var date_order = $.datepicker.formatDate("yy-mm-dd",new Date(orders[i].date_order));
            		if(self.date === date_order){
            			x.push(orders[i]);
            		}
            	}
            	orders = x;
            }
            for(var i = 0, len = Math.min(orders.length,1000); i < len; i++){
                var order    = orders[i];
                order.amount_total = parseFloat(order.amount_total).toFixed(2);
            	var clientline_html = QWeb.render('OrderlistLine',{widget: this, order:order});
                var clientline = document.createElement('tbody');
                clientline.innerHTML = clientline_html;
                clientline = clientline.childNodes[1];
                contents.appendChild(clientline);
            }
            $("table.order-list").simplePagination({
				previousButtonClass: "btn btn-danger",
				nextButtonClass: "btn btn-danger",
				previousButtonText: '<i class="fa fa-angle-left fa-lg"></i>',
				nextButtonText: '<i class="fa fa-angle-right fa-lg"></i>',
				perPage:self.pos.config.record_per_page > 0 ? self.pos.config.record_per_page : 10
			});
        },
        reload_orders: function(){
        	var self = this;
        	this.$('#select_all_orders').prop('checked', false);
            var orders = self.pos.get('pos_order_list');
            this.render_list(orders);
        },
	    reloading_orders: function(){
	    	var self = this;
	    	var date = new Date();
			var start_date;
			if(self.pos.config.last_days){
				date.setDate(date.getDate() - self.pos.config.last_days);
			}
			start_date = date.toJSON().slice(0,10);
			var domain =['create_date','>=',start_date];
	    	return new Model('pos.order').get_func('ac_pos_search_read')([['state','not in',['cancel']], domain])
	    	.then(function(result){
	    		self.pos.db.add_orders(result);
	    		self.pos.set({'pos_order_list' : result});
	    		self.reload_orders();
	    		return self.pos.get('pos_order_list');
	    	}).fail(function (error, event){
               if(error.code === 200 ){    // Business Logic Error, not a connection problem
              	self.gui.show_popup('error-traceback',{
                      message: error.data.message,
                      comment: error.data.debug
                  });
              }
              // prevent an error popup creation by the rpc failure
              // we want the failure to be silent as we send the orders in the background
              event.preventDefault();
              console.error('Failed to send orders:', orders);
              var orders=self.pos.get('pos_order_list');
      	        self.reload_orders();
      	        return orders
              });
	    },
	    renderElement: function(){
	    	var self = this;
	    	self._super();
	    	self.el.querySelector('.button.reload').addEventListener('click',this.reload_btn);
	    },
	});
	gui.define_screen({name:'orderlist', widget: OrderListScreenWidget});
});
