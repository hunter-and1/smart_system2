odoo.define('smart_system2.screens', function (require) {

    "use strict";

    const { useState,onMounted, onUnmounted } = owl.hooks;
    const { useListener } = require('web.custom_hooks');

    const pos_model = require('point_of_sale.models');
    
    const Model     = require('web.Model');

    const Registries = require("point_of_sale.Registries");
    const PosComponent  = require('point_of_sale.PosComponent');

    const ProductScreen = require("point_of_sale.ProductScreen");
    const ProductCategories = require("point_of_sale.ProductCategories");
    const ProductList = require("point_of_sale.ProductList");
    const PaymentScreen = require("point_of_sale.PaymentScreen");
    const Order = require("point_of_sale.Order");
    const Actionpad = require("point_of_sale.Actionpad");
    const ClientListScreen = require("point_of_sale.ClientListScreen");
    const ReceiptScreen = require("point_of_sale.ReceiptScreen");

    //Hooks

    function useOrderNote() {
        const keyboard_handler = e => {
            console.log('keyboard_handler');
        }
        const keyboard_keydown_handler = e => {
            console.log('keyboard_keydown_handler');
        }
        onMounted(() => {
            window.document.body.addEventListener('keypress', keyboard_handler)
            window.document.body.addEventListener('keydown', keyboard_keydown_handler)
        })
        onUnmounted(() => {
            window.document.body.removeEventListener('keypress', keyboard_handler)
            window.document.body.removeEventListener('keydown', keyboard_keydown_handler)
        })
        return {}
    }
      
    //screens

    const PosProductScreen = (_ProductScreen) => class extends _ProductScreen {

        constructor() {
            super(...arguments);
            this.pricelist_selector = "";
            this.pricelist_list = [];
            this.new_options = [{
                value:"",
                title:'Select Pricelist'
            }];
            //.push('<option value="">Select Pricelist</option>\n')

            if(this.pricelist_list.length > 0){
                for(let i = 0, len = this.pricelist_list.length; i < len; i++){
                    this.new_options.push({
                        value:this.pricelist_list[i].id,
                        title:this.pricelist_list[i].display_name
                    });
                    //this.new_options.push('<option value="' + this.pricelist_list[i].id + '">' + this.pricelist_list[i].display_name + '</option>\n');
                }
                //$('#price_list').html(this.new_options);

                let order = this.pos.get('selectedOrder');
                if(order.get_client() && order.get_client().property_product_pricelist[0]){
                    this.pricelist_selector = order.get_client().property_product_pricelist[0];
                    //$('#price_list').val(order.get_client().property_product_pricelist[0]);
                }
                //$('#price_list').selectedIndex = 0;
            }
        }

        change_price_list() {
            let partner_id = this.pos.get('selectedOrder').get_client() && parseInt(this.pos.get('selectedOrder').get_client().id);
            if (!partner_id) {
                this.pricelist_list = [];
                    alert('Pricelist will not work as customer is not selected !');
                return;
            }
        }

    };

    const PosProductCategories = (_ProductCategories) => class extends _ProductCategories {
        constructor() {
            super(...arguments);
            this.isSync = false;
        }
        //('#syncbutton').click
        click_sync_btn(){
            let currency_symbol = (this.pos && this.pos.currency) ? this.pos.currency : {symbol:'$', position: 'after', rounding: 0.01, decimals: 2};
            //$('#syncbutton').toggleClass('rotate', 'rotate-reset');
            this.isSync != this.isSync;
            this.pos.load_new_products(currency_symbol)
        }

    };

    const PosProductList = (_ProductList) => class extends _ProductList {
        constructor() {
            super(...arguments);
            this.product_list = [];
        }

        set_product_list(_product_list)
        {
            let actual_product_list = [];
            let prod_temp = [];
            if (this.pos.config.debt_dummy_product_id[0])
                prod_temp.push(this.pos.config.debt_dummy_product_id[0]);
            
            if (this.pos.config.paid_amount_product[0])
                prod_temp.push(this.pos.config.paid_amount_product[0]);
            
            _product_list.forEach(function(product) {
                if (product.id){
                    if (!prod_temp.includes(product.id)){
                        actual_product_list.push(product);
                    } 
                }
            });
            this.product_list = actual_product_list;
        }
    };

    const PosPaymentScreen = (_PaymentScreen) => class extends _PaymentScreen {
        constructor() {
            super(...arguments);

            this.state = useState({
                order_note: "",
                customer_name_html : "",
                pay_full_debt_class: ""
            });

            this.pos.on('updateDebtHistory', function(partner_ids){
                this.update_debt_history(partner_ids);
            }, this);
        }

        update_debt_history(partner_ids)
        {
            let client = this.pos.get_client();
            if (client && partner_ids.includes(client.id.id) != -1) {
                this.gui.screen_instances.products.actionpad.renderElement();
                this.customer_changed();
            }
        }

        show() {
            //useOrderNote()
            /* 
            $("textarea#order_note").focus(function() {
                window.document.body.removeEventListener('keypress',self.keyboard_handler);
                window.document.body.removeEventListener('keydown',self.keyboard_keydown_handler);
            });
            $("textarea#order_note").focusout(function() {
                window.document.body.addEventListener('keypress',self.keyboard_handler);
                window.document.body.addEventListener('keydown',self.keyboard_keydown_handler);
            });*/
        }

        finalize_validation()
        {
            let order = this.pos.get_order();

            if (order.is_paid_with_cash() && this.pos.config.iface_cashdrawer) {
                this.pos.proxy.open_cashbox();
            }

            order.initialize_validation_date();

            if (order.is_to_invoice()) {
                let invoiced = this.pos.push_and_invoice_order(order);
                this.invoicing = true;
                invoiced.fail(function(error){
                    this.invoicing = false;
                    if (error.message === 'Missing Customer') {
                        this.gui.show_popup('confirm',{
                            'title': _t('Please select the Customer'),
                            'body': _t('You need to select the customer before you can invoice an order.'),
                            confirm: function(){
                                self.gui.show_screen('clientlist');
                            },
                        });
                    } else if (error.code < 0) {        // XmlHttpRequest Errors
                        this.gui.show_popup('error',{
                            'title': _t('The order could not be sent'),
                            'body': _t('Check your internet connection and try again.'),
                        });
                    } else if (error.code === 200) {    // OpenERP Server Errors
                        this.gui.show_popup('error-traceback',{
                            'title': error.data.message || _t("Server Error"),
                            'body': error.data.debug || _t('The server encountered an error while receiving your order.'),
                        });
                    } else {                            // ???
                        this.gui.show_popup('error',{
                            'title': _t("Unknown Error"),
                            'body':  _t("The order could not be sent to the server due to an unknown error"),
                        });
                    }
                });

                invoiced.done(function(){
                    this.invoicing = false;
                    this.gui.show_screen('receipt');
                });
            } else {
                this.pos.push_order(order).then(function(){
                    this.gui.show_screen('receipt');
                });
            }
        }

        validate_order()
        {
            let order = this.pos.get_order();
            if (this.pos.config.enable_multi_sale_location){
                let lines =  order.get_orderlines();
                let line_data = [];
                let diff_location = [];
                let dict_current_location ={};
                lines.forEach(function(line) {
                    if (line.get_stock_location()){
                        if(line.get_stock_location()[0] != this.pos.config.stock_location_id[0]){
                            diff_location.indexOf(line.get_stock_location()[0]) === -1 ?
                            diff_location.push(line.get_stock_location()[0]) : console.log("");
                        }
                    }
                });
                for (let stock=0;stock<diff_location.length;stock++){
                    let line_list = []
                    for (let line=0;line<lines.length;line++){
                        if (lines[line].get_stock_location()[0] == diff_location[stock]){
                             line_list.push(lines[line])
                        }
                    }
                    dict_current_location[diff_location[stock]] = line_list;
                }
                order.set_order_stock_location(dict_current_location); 
            }
            let currentOrder = this.pos.get_order();
            if(this.pos.config.enable_order_note)
                currentOrder.set_order_note(this.state.order_note);
            
            let isDebt = currentOrder.updates_debt();
            let debt_amount = currentOrder.get_debt_delta();
            let client = currentOrder.get_client();
            if(this.pos.config.enable_debit){
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
            //this._super(force_validation);
        }

        pay_full_debt(){
            let order = this.pos.get_order();
            if (this.pos.config.enable_debit){
                let debtjournal = false;
                this.pos.cashregisters.forEach(function(cashregister) {
                    if (cashregister.journal.debt)
                        debtjournal = cashregister;
                });

                let paymentLines = order.get_paymentlines();
                if (paymentLines.length) {
                    paymentLines.forEach(function(paymentLine) {
                        if (paymentLine.cashregister.journal.debt){
                            paymentLine.destroy();
                        }
                    });
                }
                //var order = self.pos.get_order();
                let product = this.pos.db.get_product_by_id(this.pos.config.debt_dummy_product_id[0]);
                order.add_product(product);
                let newDebtPaymentline = new pos_model.Paymentline({},{order: order, cashregister: debtjournal, pos: this.pos});
                newDebtPaymentline.set_amount(order.get_client().debt * -1);
                order.paymentlines.add(newDebtPaymentline);
                //this.render_paymentlines();
            }
        }

        pay_partial_debt(){
            let order = this.pos.get_order();
            if (this.pos.config.enable_debit){
                let debtjournal = false;
                this.pos.cashregisters.forEach(function(cashregister) {
                    if (cashregister.journal.debt) {
                        debtjournal = cashregister;
                    }
                });

                var paymentLines = order.get_paymentlines();
                if (paymentLines.length) {
                    paymentLines.forEach(function(paymentLine) {
                        if (paymentLine.cashregister.journal.debt){
                            paymentLine.destroy();
                        }
                    });
                }
                //var order = self.pos.get_order();
                let product = this.pos.db.get_product_by_id(this.pos.config.debt_dummy_product_id[0]);
                order.add_product(product);
                let newDebtPaymentline = new pos_model.Paymentline({},{order: order, cashregister: debtjournal, pos: this.pos});
                newDebtPaymentline.set_amount(amount * -1);
                order.paymentlines.add(newDebtPaymentline);
                //this.render_paymentlines();
            }
        }

        is_paid(){
            let currentOrder = this.pos.get_order();
            return (currentOrder.getPaidTotal() + 0.000001 >= currentOrder.getTotalTaxIncluded());
        }

        customer_changed() {
            if (this.pos.config.enable_debit){
                let client = this.pos.get_client();
                let debt = 0;
                if (client) {
                    debt = Math.round(client.debt * 100) / 100;
                    if (client.debt_type == 'credit')
                        debt = - debt;
                }


                this.state.customer_name_html = client ? client.name : _t('Customer');
                this.state.pay_full_debt_class = "oe_hidden";
                //$js_customer_name.text(client ? client.name : _t('Customer'));
                //$pay_full_debt.addClass('oe_hidden');

                if (client && debt) {
                    if (client.debt_type == 'debt') {
                        if (debt > 0) {
                            this.state.pay_full_debt_class = "";
                            this.state.customer_name_html += '<span class="client-debt positive"> [Debt: ' + debt + ']</span>';
                            //$pay_full_debt.removeClass('oe_hidden');
                            //$js_customer_name.append('<span class="client-debt positive"> [Debt: ' + debt + ']</span>');
                        } else if (debt < 0) {
                            this.state.customer_name_html += '<span class="client-debt negative"> [Debt: ' + debt + ']</span>';
                            //$js_customer_name.append('<span class="client-debt negative"> [Debt: ' + debt + ']</span>');
                        }
                    } else if (client.debt_type == 'credit') {
                        if (debt > 0) {
                            this.state.customer_name_html += '<span class="client-credit positive"> [Credit: ' + debt + ']</span>';
                            //$js_customer_name.append('<span class="client-credit positive"> [Credit: ' + debt + ']</span>');
                        } else if (debt < 0) {
                            $pay_full_debt.removeClass('oe_hidden');
                            this.state.pay_full_debt_class = "";
                            this.state.customer_name_html += '<span class="client-credit negative"> [Credit: ' + debt + ']</span>';
                            //$js_customer_name.append('<span class="client-credit negative"> [Credit: ' + debt + ']</span>');
                        }
                    }
                }
            }
        }

        click_delete_paymentline(cid){
            let lines = this.pos.get_order().get_paymentlines();
            for (let i = 0; i < lines.length; i++ ) {
                if (lines[i].cid === cid) {
                    if(lines[i] && lines[i].get_dummy_line()){
                        return;
                    }
                }
            }
            //this._super(cid);
        }
    };

    const PosOrder = (_Order) => class extends _Order {

        constructor() {
            super(...arguments);

            this.state = useState({
                total_qty: 0, //.summary .total .total_qty .value
                no_items : 0, //.summary .total .no_items .value
                margin : 0, //.summary .total .margin .value
            });


        }
        
        click_line(orderline, e) {
            if (e.target.id == 'stock_location'){
                this.gui.show_popup('stock_loction_popup');
            }
            this.pos.get_order().select_orderline(orderline);
            this.numpad_state.reset();
        }

        set_value(val)
        {
            let order = this.pos.get_order();
            if (order.get_selected_orderline()) {
                let mode = this.numpad_state.get('mode');
                if( mode === 'quantity'){
                	//let partner = order.get_client();
                	let pricelist_id = order.get_pricelist();
                    if (pricelist_id && order.get_selected_orderline() && (val != 'remove')) {
                        //let qty = order.get_selected_orderline().get_quantity();
                        let p_id = order.get_selected_orderline().get_product().id;
                        if (! val) {
                            val = 1;
                        }
                        new Model("product.pricelist").get_func('price_get')([pricelist_id], p_id, parseInt(val)).pipe(
                            function(res){
                                if (res[pricelist_id]) {
                                    let pricelist_value = parseFloat(res[pricelist_id].toFixed(2));
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

                }else if( mode === 'discount'){
                    order.get_selected_orderline().set_discount(val);

                }else if( mode === 'price'){
                    order.get_selected_orderline().set_unit_price(val);
                }
            }
        }

        update_summary(){
			let order = this.pos.get_order();
			if (!order.get_orderlines().length)
			    return;
			
			if(this.pos.config.enable_cart_detail){

	            let orderline_quantity = order.get_orderlines();

				this.state.total_qty = 0;
                this.state.no_items = orderline_quantity.length;

                orderline_quantity.forEach(function(select_quantity) {
                    this.state.total_qty += select_quantity.quantity;
	            });
	            order.set_total_qty(this.state.total_qty);
	        }

	        if(this.pos.config.enable_margin){
				this.state.margin = this.format_currency(order ? order.get_total_margin() : 0);
			}

			if(this.pos.config.enable_show_cost_price && order.get_selected_orderline()){
			    let selected_line = order.get_selected_orderline();
			    if (selected_line.get_discount()){
			        let total_cost_price = selected_line.get_product().standard_price * selected_line.get_quantity();
                    if (selected_line.get_display_price() < total_cost_price){
                        this.pos.db.notification('info','Sale price is less then cost price!');
                        //$('.pos .order .orderline.selected').css("background","#F57D7D");
                    }
			    } else {
			        if (selected_line.get_unit_price() < selected_line.get_product().standard_price){
                        this.pos.db.notification('info','Sale price is less then cost price!');
                        //$('.pos .order .orderline.selected').css("background","#F57D7D");
                    }
			    }
			}
        }

        /* 
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
        }

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
        }*/
    };

	const PosActionpad = (_Actionpad) => class extends _Actionpad {
        constructor() {
            super(...arguments);

            this.state = useState({
                debtjournal: false,
                enable_debit : this.pos.config.enable_debit,
            });

            this.pos.cashregisters.forEach(function(cashregister) {
                if (cashregister.journal.debt) {
                    this.state.debtjournal = cashregister.journal_id[0];
                }
            });
        }
        
        //.pay
        click_pay()
        {
            if(!this.state.enable_debit)
                return;

            let order = this.pos.get_order();
            let has_valid_product_lot = _.every(order.orderlines.models, function(line){
                return line.has_valid_product_lot();
            });

            if(!has_valid_product_lot){
                this.gui.show_popup('confirm',{
                    'title': _t('Empty Serial/Lot Number'),
                    'body':  _t('One or more product(s) required serial/lot number.'),
                    confirm: function(){
                        this.gui.show_screen('payment');
                    },
                });
            }
            else
            {
                this.gui.show_screen('payment');
            }

            if (order.get_orderlines().length> 0 && this.state.debtjournal && !order.get_edit_pos_order()){
                this.pos.gui.screen_instances.payment.click_paymentmethods(debtjournal);
                if(order.selected_paymentline){
                    order.selected_paymentline.set_amount( Math.max(order.get_total_with_tax(),0) );
                }
            }
        }

        //.set-customer
        click_set_customer()
        {
            this.gui.show_screen('clientlist');
        }

    };

    const PosClientListScreen = (_ClientListScreen) => class extends _ClientListScreen {
        constructor() {
            super(...arguments);

            this.state = useState({
                price_list: "", //#price_list
            });
        }

        save_changes(){
            if( this.has_client_changed()){
            	if(this.new_client){
            		this.pos.get_order().set_pricelist_val(this.new_client.id);
            	} else {
                    this.state.price_list = "";
            	}
            }
        }
    };

    const PosReceiptScreen = (_ReceiptScreen) => class extends _ReceiptScreen {
        constructor() {
            super(...arguments);
        }

        //.button.print_pdf
        print_pdf()
        {
            if (!this._locked) {
                // generate the pdf and download it
                if(this.pos.order_to_print){
                    this.chrome.do_action('smart_system2.report_pos_receipt', {additional_context:{
                        active_ids:[this.pos.order_to_print],
                    }});
                }
            }
        }

        render_receipt() {
            let order = this.pos.get_order();
            let print_locations = order.get_order_stock_location();
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
        }

        print_xml()
        {
            let order = this.pos.get_order();
            if (this.pos.config.enable_multi_sale_location){
                let print_locations = order.get_order_stock_location();
                if (print_locations){
                    for (let key in print_locations) {
                        let param = {
                            widget:this,
                            data:print_locations[key],
                            order: order,
                            receipt: order.export_for_printing(),
                        }
                        let store_location_receipt = QWeb.render('xml_store_location_receipt', param);
                        this.pos.proxy.print_receipt(store_location_receipt);
                    }
                }
            }
        }
    };

    Registries.Component.extend(ProductScreen, PosProductScreen);
    Registries.Component.extend(ProductCategories, PosProductCategories);
    Registries.Component.extend(ProductList, PosProductList);
    Registries.Component.extend(PaymentScreen, PosPaymentScreen);
    Registries.Component.extend(Order, PosOrder);
    Registries.Component.extend(Actionpad, PosActionpad);
    Registries.Component.extend(ClientListScreen, PosClientListScreen);
    Registries.Component.extend(ReceiptScreen, PosReceiptScreen);

    
    /*
    var screens   = require('point_of_sale.screens');
    var pos_model = require('point_of_sale.models');
    var Model     = require('web.Model');
    var core      = require('web.core');
    const {Gui}   = require("point_of_sale.Gui");

    //var db = require('point_of_sale.DB');
    //var Dialog = require('web.Dialog');

    var QWeb = core.qweb;
    var time = require('web.time');

    var _t = core._t;
     */

    //AddProductButton
    class AddProductButton extends PosComponent{
        constructor() {
            super(...arguments);
            useListener('click', this.onClick);
        }
        onClick() {
            this.gui.show_popup('add_product_popup');
        }
    }
    ProductScreen.addControlButton({
        component: AddProductButton,
        condition: function() {
            return this.this.pos.config.enable_add_product;
        },
    });
    Registries.Component.add(AddProductButton);

    //PayFullDebt
    class PayFullDebt extends PosComponent{
        constructor() {
            super(...arguments);
            useListener('click', this.onClick);
        }
        onClick() {
            this.gui.show_popup('PayDebtPopupWidget');
        }
    }
    ProductScreen.addControlButton({
        component: PayFullDebt,
        condition: function() {
            return this.this.pos.config.enable_debit;
        },
    });
    Registries.Component.add(PayFullDebt);

    //PayFullDebt
    class AddNoteButton extends PosComponent{
        constructor() {
            super(...arguments);
            useListener('click', this.onClick);
        }
        onClick() {
            let order    = this.pos.get_order();
            let lines    = order.get_orderlines();
            if(lines.length > 0) {
                if (order.get_selected_orderline()) {
                    this.gui.show_popup('add_note_popup');
                }
            } else {
                alert("Please select the product !");
            }
        }
    }
    ProductScreen.addControlButton({
        component: AddNoteButton,
        condition: function() {
            return this.this.pos.config.enable_product_note;
        },
    });
    Registries.Component.add(AddNoteButton);

    //ShowOrderList
    class ShowOrderList extends PosComponent{
        constructor() {
            super(...arguments);
            useListener('click', this.onClick);
        }
        onClick() {
            this.gui.show_popup('orderlist');
        }
    }
    ProductScreen.addControlButton({
        component: ShowOrderList,
        condition: function() {
            return this.this.pos.config.enable_order_list;
        },
    });
    Registries.Component.add(ShowOrderList);

    return {
        ProductScreen,
        ProductCategories,
        ProductList,
        PaymentScreen,
        Order,
        Actionpad,
        ClientListScreen,
        ReceiptScreen
    };


    /* Order list screen 
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
    */
});
