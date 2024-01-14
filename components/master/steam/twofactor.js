const Account = require("./index");

Account.prototype.has_phone = async function(repeat = true){
    const result = await new Promise(res=>{
        this.steam_store.hasPhone((error, hasVerifiedPhone, lastDigits)=>{
            if (error) res({success: false, error: error.message});
            else res({success: true, has_phone: hasVerifiedPhone, last_digits: lastDigits});
        })
    })

    if (result.success || !repeat) return result
    else return await this.has_phone();
}

Account.prototype.add_phone_number = function(number){
    return new Promise(res=>{
        this.steam_store.addPhoneNumber(number, true, error=>{
            if (error) res({success: false, error: error.message})
            else {
                this.number = number;
                res({success: true})
            }
        })
    })
}

Account.prototype.send_sms = function(){
    return new Promise(res=>{
        this.steam_store.sendPhoneNumberVerificationMessage(error=>{
            if (error) res({success: false, error: error.message})
            else res({success: true})
        })
    })
}

Account.prototype.resend_sms = function(){
    return new Promise(res=>{
        this.steam_store.resendVerificationSMS(error=>{
            if (error) res({success: false, error: error.message})
            else res({success: true})
        })
    })
}

Account.prototype.confirm_phone = function(code){
    return new Promise(res=>{
        this.steam_store.verifyPhoneNumber(code, error=>{
            if (error) res({success: false, error: error.message})
            else res({success: true})
        })
    })
}

Account.prototype.activate_2fa = function(){

    this.community.setMobileAppAccessToken(this.access_token);

    return new Promise(res=>{
        this.community.enableTwoFactor((error, twofa)=>{
            if (error) res({success: false, error: error.message})
            else {
                this.two_fa = {
                    ...twofa
                }
                res({success: true, r_code: twofa.revocation_code})
            }
        })
    })
}

Account.prototype.finalize_2fa = function (code){
    return new Promise(res=>{
        this.community.finalizeTwoFactor(this.two_fa.shared_secret, code, (error)=>{
            if (error) res({success: false, error: error.message})
            else res({success: true})
        })
    })
}